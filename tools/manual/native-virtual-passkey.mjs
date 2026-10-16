/** Manual QA only. This test's resident passkey stays in RAM; no files or I/O
 * occur until attach is explicitly given its owned browser page. */
const fail = () => { throw Object.assign(new Error('Manual QA passkey synchronization refused.'), { code: 'qa_oauth_passkey_sync_refused' }); };
const immutable = ['credentialId', 'privateKey', 'rpId', 'userHandle', 'isResidentCredential'];
const valid = value => value && typeof value === 'object' && !Array.isArray(value)
  && typeof value.credentialId === 'string' && value.credentialId.length > 0
  && typeof value.privateKey === 'string' && value.privateKey.length > 0
  && typeof value.rpId === 'string' && value.rpId.length > 0
  && value.isResidentCredential === true && Number.isSafeInteger(value.signCount)
  && value.signCount >= 0 && value.signCount <= 0xffffffff;

export function createNativeQaPasskey() {
  let held = null, failed = false, registrationAttached = false, closed = false, assertions = 0;
  const listeners = [];
  function update(value, asserted = false) {
    if (closed || failed || !valid(value) || (held && (immutable.some(key => value[key] !== held[key])
      || value.signCount < held.signCount || (asserted && value.signCount === held.signCount)))) {
      failed = true; fail();
    }
    held = structuredClone(value);
    if (asserted) assertions++;
  }
  const credential = () => { if (closed || failed) fail(); return held ? structuredClone(held) : null; };
  return Object.freeze({ credential,
    status: () => ({ present: !!held, assertions, failed }),
    async attach(page, { register = false } = {}) {
      const original = credential();
      if (typeof register !== 'boolean' || (register ? registrationAttached || !!original : !original)) fail();
      if (register) registrationAttached = true;
      const client = await page.context().newCDPSession(page);
      await client.send('WebAuthn.enable');
      const { authenticatorId } = await client.send('WebAuthn.addVirtualAuthenticator', { options: {
        protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true,
        isUserVerified: true, automaticPresenceSimulation: true,
      } });
      let completed = false, resolveEvent, rejectEvent;
      const proofEvent = new Promise((resolve, reject) => { resolveEvent = resolve; rejectEvent = reject; });
      proofEvent.catch(() => {});
      const onEvent = asserted => event => {
        if (event.authenticatorId !== authenticatorId || closed) return;
        // Event handlers never throw credential-containing errors into Node.
        // The next read/sync refuses after a mismatched or regressed event.
        try {
          update(event.credential, asserted);
          if ((register && !asserted) || (!register && asserted)) { completed = true; resolveEvent(); }
        } catch { failed = true; rejectEvent(Object.assign(new Error('Manual QA passkey synchronization refused.'), { code: 'qa_oauth_passkey_sync_refused' })); }
      };
      const added = onEvent(false), asserted = onEvent(true);
      client.on('WebAuthn.credentialAdded', added); client.on('WebAuthn.credentialAsserted', asserted);
      listeners.push(() => {
        client.off('WebAuthn.credentialAdded', added); client.off('WebAuthn.credentialAsserted', asserted);
        rejectEvent(Object.assign(new Error('Manual QA passkey synchronization closed.'), { code: 'qa_oauth_passkey_sync_refused' }));
      });
      if (original) await client.send('WebAuthn.addCredential', { authenticatorId, credential: original });
      return Object.freeze({ client, authenticatorId,
        async waitForCredential({ timeoutMs = 60000 } = {}) {
          if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) fail();
          if (completed) { credential(); return; }
          let timer;
          try { await Promise.race([proofEvent, new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(
            new Error('Manual QA passkey event was not observed.'), { code: 'qa_oauth_passkey_event_pending' })), timeoutMs); })]); }
          finally { clearTimeout(timer); }
          credential();
        },
        async sync() {
          const { credentials } = await client.send('WebAuthn.getCredentials', { authenticatorId });
          if (!Array.isArray(credentials) || credentials.length !== 1) { failed = true; fail(); }
          update(credentials[0]); return { present: true, assertions, failed: false };
        },
      });
    },
    close() { closed = true; held = null; for (const remove of listeners.splice(0)) remove(); },
  });
}
