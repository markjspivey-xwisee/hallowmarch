/** Interego's general guest as a way into the game (issue 105). Offline: identity, its door page
 * and the relay's signer are stand-ins made here, with made-up origins, keys and tokens only. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { createGameSessionTokens } from './game-session.js';
import { configuredGeneralGuest, createGeneralGuestAccounts, createGeneralGuestDoor, createGeneralGuestHost, generalGuestAccountId,
  generalGuestPath, guestSessionStanding, provisionalMayUse, subjectFacts, GENERAL_GUEST_COOKIE, GENERAL_GUEST_PURPOSE,
  LINKED_GUEST_SESSION_MS, generalGuestSweep, generalGuestSaveRecord, generalGuestOrphans } from './general-guest.js';

const ISSUER = 'https://identity.example', DOOR = 'https://door.identity.example';
const GAME = 'https://game.example', OTHER = 'https://other.example';
const RETURN = '/guest/general/return', START = '/guest/general/start', SESSION = '/guest/general/session';
const AGENT = { agentDid: 'did:web:identity.example:agents:game-service', podUrl: 'https://pods.example/game-service/' };
const USERS = 'did:web:identity.example:users:';
const IDENTITY_TOKEN = 'cg2_fixture_identity_token';
const T0 = 1_800_000_000_000;
const sha = value => createHash('sha256').update(value).digest('base64url');

/** Identity with the general guest door on for `applications`, its door page, and the relay's signer. */
function standIn(clock, applications = { [GAME]: RETURN, [OTHER]: '/return' }) {
  const relayKey = randomBytes(32), guests = new Map(), codes = new Map(), exchanges = [];
  const signature = payload => '0x' + createHmac('sha512', relayKey).update(payload).digest('hex') + '1b';
  const state = { tamper: null, down: false };
  /** What the relay's sign_request does for a service agent: adds who and when, and signs. */
  const signAs = (who = AGENT, alter = value => value) => async request => {
    const _signed_payload = JSON.stringify(alter({ ...request, agent_id: who.agentDid, subject_pod_url: who.podUrl, timestamp: new Date(clock.t).toISOString() }));
    return { _signed_payload, _signature: signature(_signed_payload) };
  };
  const guestOf = key => {
    const userId = 'u-try-guest-' + createHash('sha256').update(key).digest('hex').slice(0, 32);
    if (!guests.has(userId)) guests.set(userId, { userId, establishedAt: Math.floor(clock.t / 1000), standingUntil: Math.floor(clock.t / 1000) + 86400,
      admittedBy: new Set(), linkedTo: null, thumbprint: sha(key) });
    return guests.get(userId);
  };
  /** The door page: the browser's key answers the grant from the address it was sent to; identity says where to go back. */
  function page(key, doorUrl) {
    const url = new URL(doorUrl);
    assert.equal(url.origin + url.pathname, DOOR + '/guest/door'); assert.equal(url.search, '');
    const grant = JSON.parse(Buffer.from(new URLSearchParams(url.hash.slice(1)).get('grant'), 'base64url').toString('utf8'));
    assert.equal(grant._signature, signature(grant._signed_payload), 'the relay signed this grant');
    const asked = JSON.parse(grant._signed_payload);
    assert.equal(asked.purpose, GENERAL_GUEST_PURPOSE); assert.equal(asked.agent_id, AGENT.agentDid);
    assert.ok(Object.hasOwn(applications, asked.audience)); assert.ok(asked.expiresAt * 1000 > clock.t && asked.expiresAt * 1000 <= clock.t + 120_000);
    assert.match(asked.state, /^[A-Za-z0-9_-]{20,128}$/); assert.match(asked.codeChallenge, /^[A-Za-z0-9_-]{43}$/);
    const guest = guestOf(key); guest.admittedBy.add(asked.audience);
    const code = randomBytes(24).toString('base64url');
    codes.set(code, { audience: asked.audience, state: asked.state, challenge: asked.codeChallenge, userId: guest.userId, expiresAt: clock.t + 60_000, used: false });
    return `${asked.audience}${applications[asked.audience]}?code=${code}&state=${asked.state}`;
  }
  function exchange(body) {
    exchanges.push(structuredClone(body));
    const record = codes.get(body.code);
    if (!record || record.expiresAt <= clock.t || record.audience !== body.audience || record.state !== body.state
      || sha(body.codeVerifier ?? '') !== record.challenge) return [401, { valid: false, error: 'invalid_guest_code' }];
    if (record.used) return [409, { valid: false, error: 'guest_code_already_used' }];
    record.used = true;
    const guest = guests.get(record.userId), ownerDid = USERS + guest.userId;
    return [200, { valid: true, provisional: true, general: true, issuer: ISSUER, audience: record.audience, userId: guest.userId, ownerDid,
      webId: `${ISSUER}/users/${guest.userId}/profile#me`, podUrl: `https://pods.example/${guest.userId}/`,
      authenticatedAgentId: 'guest-agent', authenticatedAgentDid: 'did:web:identity.example:agents:guest-agent', proofKeyThumbprint: guest.thumbprint,
      guestExpiresAt: new Date(guest.standingUntil * 1000).toISOString(), namespace: 'game',
      subjectAttributes: { subject: ownerDid, provisional: true, claimed: false, establishedAt: guest.establishedAt, standingUntil: guest.standingUntil,
        admittedBy: [record.audience], proofKeyThumbprint: guest.thumbprint, ...(guest.linkedTo ? { linkedTo: guest.linkedTo } : {}) },
      token: IDENTITY_TOKEN, tokenExpiresAt: new Date(clock.t + 3_600_000).toISOString() }];
  }
  const fetch = async (url, init) => {
    assert.equal(url, ISSUER + '/guest/exchange'); assert.equal(init.method, 'POST'); assert.equal(init.redirect, 'error');
    if (state.down) return new Response('unavailable', { status: 503 });
    let [status, body] = exchange(JSON.parse(init.body));
    if (state.tamper && status === 200) body = state.tamper(body);
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  };
  return { signAs, page, fetch, exchanges, state, codes,
    link(key, accountUserId) { guestOf(key).linkedTo = USERS + accountUserId; return USERS + accountUserId; },
    unlink(key) { guestOf(key).linkedTo = null; },
    guestDid: key => USERS + guestOf(key).userId };
}

/** The game with the door on, as server.js composes it. */
function game(clock, identity, overrides = {}) {
  const now = () => clock.t, accounts = {}, sessions = createGameSessionTokens({ secret: 'fixture-session-secret', now });
  const guestAccounts = createGeneralGuestAccounts({ accounts, sessions, now });
  const host = configuredGeneralGuest({ env: { HM_GENERAL_GUEST: '1', HM_GENERAL_GUEST_DOOR_ORIGIN: DOOR, HM_GENERAL_GUEST_DIRECT: '1' }, publicOrigin: GAME, publicOriginConfigured: true,
    identityOrigin: ISSUER, signGrant: identity.signAs(), issueSession: standing => guestAccounts.issue(standing), fetch: identity.fetch, now, ...overrides });
  return { host, accounts, sessions, guestAccounts };
}
/** One browser: a cookie jar and the addresses it was sent to. */
function browser(host, seen) {
  let cookie = null;
  return { get cookie() { return cookie; }, set cookie(value) { cookie = value; },
    async visit(method, target, { origin, hostHeader = 'game.example' } = {}) {
      const result = { status: 0, headers: {}, body: '', handled: false };
      const res = { headersSent: false,
        writeHead(status, headers = {}) { result.status = status; Object.assign(result.headers, headers); this.headersSent = true; },
        end(body = '') { result.body = String(body); } };
      const req = { method, url: target, socket: { remoteAddress: arguments[2]?.address ?? '203.0.113.7' },
        headers: { host: hostHeader, ...(cookie ? { cookie: `other=1; ${GENERAL_GUEST_COOKIE}=${cookie}` } : {}), ...(origin ? { origin } : {}), ...(arguments[2]?.headers ?? {}) } };
      result.handled = await host.handle(req, res);
      const set = result.headers['Set-Cookie'];
      if (set) {
        assert.match(set, new RegExp(`^${GENERAL_GUEST_COOKIE}=[A-Za-z0-9_-]*; Path=/; Max-Age=\\d+; HttpOnly; Secure; SameSite=Lax$`));
        const value = set.split(';')[0].split('=')[1]; cookie = value || null;
      }
      if (result.headers.Location) seen.push(result.headers.Location);
      if (result.body) seen.push(result.body);
      if (set) seen.push(set);
      result.json = () => JSON.parse(result.body);
      return result;
    } };
}
const pathOf = address => { const url = new URL(address); return url.pathname + url.search; };
async function arrive(b, identity, key) {
  const started = await b.visit('GET', START);
  assert.equal(started.status, 302);
  const back = identity.page(key, started.headers.Location);
  const returned = await b.visit('GET', pathOf(back));
  return { started, back, returned };
}
const collect = b => b.visit('POST', SESSION, { origin: GAME });

test('a general guest goes through the door and collects one bounded game session', async () => {
  const clock = { t: T0 }, identity = standIn(clock), seen = [], { host, accounts, sessions, guestAccounts } = game(clock, identity);
  const b = browser(host, seen), key = 'browser-key-one';
  const { started, back, returned } = await arrive(b, identity, key);
  assert.equal(started.headers['Cache-Control'], 'no-store'); assert.equal(started.headers['Referrer-Policy'], 'no-referrer');
  assert.ok(started.headers.Location.startsWith(DOOR + '/guest/door#grant='));
  assert.equal(returned.status, 302); assert.equal(returned.headers.Location, GAME + '/?interego-guest=arrived');
  const exchanged = identity.exchanges.at(-1);
  assert.deepEqual(Object.keys(exchanged).sort(), ['audience', 'code', 'codeVerifier', 'state']);
  assert.equal(exchanged.audience, GAME); assert.match(exchanged.codeVerifier, /^[A-Za-z0-9_-]{43,128}$/);

  const session = await collect(b);
  assert.equal(session.status, 200);
  const given = session.json(), guestDid = identity.guestDid(key);
  assert.deepEqual(Object.keys(given).sort(), ['acct', 'expiresAt', 'linked', 'token']);
  assert.equal(given.linked, false); assert.equal(given.acct.id, generalGuestAccountId(guestDid)); assert.equal(b.cookie, null, 'the visit cookie is cleared');
  const claims = sessions.read(given.token);
  assert.equal(claims.generalGuest, true); assert.equal(claims.guestSubjectDid, guestDid); assert.equal(claims.guestDid, guestDid);
  assert.equal(claims.nativeDid, undefined, 'never a native owner');
  assert.equal(given.expiresAt, claims.exp); assert.ok(claims.exp <= T0 + 4 * 3_600_000 && claims.exp <= T0 + 86_400_000);
  assert.equal(guestAccounts.accountFor(claims), accounts[given.acct.id]);
  assert.deepEqual({ ...accounts[given.acct.id], created: 0, last: 0 }, { id: given.acct.id, name: 'Guest', guest: true, generalGuest: true, created: 0, last: 0, guestUntil: T0 + 86_400_000 });
  assert.equal(guestAccounts.principalFor({ acct: accounts[given.acct.id], authClaims: claims }), guestDid);

  // Collected once: the same cookie, or none, gets nothing more.
  b.cookie = started.headers['Set-Cookie'].split(';')[0].split('=')[1];
  assert.equal((await collect(b)).status, 401);
  // Nothing secret is in any address, cookie or body but the game's own session to the page that collected it.
  const verifier = exchanged.codeVerifier, code = new URL(back).searchParams.get('code');
  for (const item of seen) {
    assert.ok(!item.includes(verifier), 'the PKCE verifier never leaves the server');
    assert.ok(!item.includes(IDENTITY_TOKEN), 'identity\'s token is not kept or passed on');
    if (item !== session.body) assert.ok(!item.includes(given.token), 'the game session is only in the collected body');
    if (item.startsWith(GAME)) assert.ok(!item.includes(code) && !/[?&](code|state|token)=/.test(item), 'no code or token in an address the browser stays on');
  }
  // The session ends at its bound on the socket side too.
  clock.t = claims.exp;
  assert.equal(sessions.read(given.token), null);
  assert.equal(guestAccounts.principalFor({ acct: accounts[given.acct.id], authClaims: claims }), null);
});

test('a return without the cookie, or with another browser\'s, finishes nothing and spends nothing', async () => {
  const clock = { t: T0 }, identity = standIn(clock), seen = [], { host } = game(clock, identity);
  const mine = browser(host, seen), stranger = browser(host, seen), other = browser(host, seen);
  const started = await mine.visit('GET', START), back = identity.page('key-a', started.headers.Location);
  // A stranger holding the return address, with no cookie.
  const bare = await stranger.visit('GET', pathOf(back));
  assert.equal(bare.headers.Location, GAME + '/?interego-guest=refused'); assert.equal((await collect(stranger)).status, 401);
  // Another browser that started its own visit, presenting the first one's code and state.
  await other.visit('GET', START);
  const crossed = await other.visit('GET', pathOf(back));
  assert.equal(crossed.headers.Location, GAME + '/?interego-guest=refused'); assert.equal((await collect(other)).status, 401);
  assert.equal(identity.exchanges.length, 0, 'neither reached identity: the code is unspent');
  // The browser that started the visit still finishes it.
  const returned = await mine.visit('GET', pathOf(back));
  assert.equal(returned.headers.Location, GAME + '/?interego-guest=arrived'); assert.equal((await collect(mine)).status, 200);
});

test('a replayed code or return address makes no second session', async () => {
  const clock = { t: T0 }, identity = standIn(clock), seen = [], { host } = game(clock, identity);
  const b = browser(host, seen), { started, back } = await arrive(b, identity, 'key-replay');
  const binding = b.cookie;
  assert.equal((await collect(b)).status, 200);
  // The same browser, cookie restored, presenting the same return address again: the visit is spent.
  b.cookie = binding;
  const again = await b.visit('GET', pathOf(back));
  assert.equal(again.headers.Location, GAME + '/?interego-guest=refused'); assert.equal((await collect(b)).status, 401);
  assert.equal(identity.exchanges.length, 1, 'the code went to identity once');
  // A new visit of that browser cannot spend the old code either: it is bound to the old state, and used.
  const fresh = await b.visit('GET', START), old = new URL(back);
  const grant = JSON.parse(Buffer.from(new URL(fresh.headers.Location).hash.slice('#grant='.length), 'base64url').toString('utf8'));
  const state = JSON.parse(grant._signed_payload).state;
  const replay = await b.visit('GET', `${RETURN}?code=${old.searchParams.get('code')}&state=${state}`);
  assert.equal(replay.headers.Location, GAME + '/?interego-guest=refused'); assert.equal((await collect(b)).status, 401);
  assert.notEqual(started.headers.Location, fresh.headers.Location);
});

test('every part of identity\'s answer is checked before it is trusted', async () => {
  const guestId = body => body.userId;
  const cases = {
    'another audience': body => ({ ...body, audience: OTHER }),
    'another issuer': body => ({ ...body, issuer: 'https://identity.attacker.example' }),
    'not valid': body => ({ ...body, valid: false }),
    'not provisional': body => ({ ...body, provisional: false }),
    'not general': body => ({ ...body, general: false }),
    'malformed userId': body => ({ ...body, userId: 'u-try-guest-XYZ', ownerDid: USERS + 'u-try-guest-XYZ', subjectAttributes: { ...body.subjectAttributes, subject: USERS + 'u-try-guest-XYZ' } }),
    'a per-application guest id': body => ({ ...body, userId: body.userId.replace('u-try-guest-', 'u-try-play-') }),
    'an owner that is not that user': body => ({ ...body, ownerDid: USERS + 'u-try-guest-' + '0'.repeat(32) }),
    'an owner of another authority': body => ({ ...body, ownerDid: 'did:web:elsewhere.example:users:' + guestId(body),
      subjectAttributes: { ...body.subjectAttributes, subject: 'did:web:elsewhere.example:users:' + guestId(body) } }),
    'attributes about another subject': body => ({ ...body, subjectAttributes: { ...body.subjectAttributes, subject: USERS + 'someone-else' } }),
    'no attributes': body => ({ ...body, subjectAttributes: undefined }),
    'an unknown attribute': body => ({ ...body, subjectAttributes: { ...body.subjectAttributes, admin: true } }),
    'an expired guest': body => ({ ...body, guestExpiresAt: new Date(T0 - 1000).toISOString(), subjectAttributes: { ...body.subjectAttributes, standingUntil: T0 / 1000 - 1 } }),
    'a deadline the attributes do not state': body => ({ ...body, guestExpiresAt: new Date(T0 + 7 * 86_400_000).toISOString() }),
    'not admitted by this application': body => ({ ...body, subjectAttributes: { ...body.subjectAttributes, admittedBy: [OTHER] } }),
    'linked to itself': body => ({ ...body, subjectAttributes: { ...body.subjectAttributes, linkedTo: body.ownerDid } }),
    'linked to an account of another authority': body => ({ ...body, subjectAttributes: { ...body.subjectAttributes, linkedTo: 'did:web:elsewhere.example:users:alice' } }),
    'not an object': () => ['valid'],
  };
  for (const [name, tamper] of Object.entries(cases)) {
    const clock = { t: T0 }, identity = standIn(clock), seen = [], { host, accounts } = game(clock, identity);
    identity.state.tamper = tamper;
    const b = browser(host, seen), { returned } = await arrive(b, identity, 'key-' + name);
    assert.equal(returned.headers.Location, GAME + '/?interego-guest=refused', name);
    assert.equal(b.cookie, null, name + ': the spent visit\'s cookie is cleared');
    assert.equal((await collect(b)).status, 401, name); assert.deepEqual(accounts, {}, name + ': no account is made');
  }
  // Identity unreachable is not a refusal of the guest, and still makes no session.
  const clock = { t: T0 }, identity = standIn(clock), { host } = game(clock, identity), b = browser(host, []);
  identity.state.down = true;
  assert.equal((await arrive(b, identity, 'key-down')).returned.headers.Location, GAME + '/?interego-guest=unavailable');
  assert.equal((await collect(b)).status, 401);
});

test('the grant leaves only if the relay signed exactly the five values asked for', async () => {
  const clock = { t: T0 }, identity = standIn(clock);
  const alterations = { purpose: 'interego-play-provisional-v1', audience: OTHER, state: 's'.repeat(43), codeChallenge: 'c'.repeat(43), expiresAt: 1 };
  for (const [field, value] of Object.entries(alterations)) {
    const { host } = game(clock, identity, { signGrant: identity.signAs(AGENT, signed => ({ ...signed, [field]: value })) });
    const b = browser(host, []), started = await b.visit('GET', START);
    assert.equal(started.headers.Location, GAME + '/?interego-guest=unavailable', field); assert.equal(b.cookie, null, field);
    assert.equal(host.status().visits, 0, field);
  }
  for (const signGrant of [async () => ({ _signed_payload: '{}', _signature: 'not-a-signature' }), async () => null, async () => { throw new Error('relay down'); }]) {
    const { host } = game(clock, identity, { signGrant }), b = browser(host, []);
    assert.equal((await b.visit('GET', START)).headers.Location, GAME + '/?interego-guest=unavailable');
  }
  // What is asked: this deployment's origin, the purpose, a fresh state, the verifier's challenge, at most 120 seconds.
  const asked = [], { host } = game(clock, identity, { signGrant: request => { asked.push(request); return identity.signAs()(request); } });
  const b = browser(host, []), key = 'key-grant', { back } = await arrive(b, identity, key);
  assert.deepEqual(Object.keys(asked[0]).sort(), ['audience', 'codeChallenge', 'expiresAt', 'purpose', 'state']);
  assert.equal(asked[0].purpose, 'interego-general-guest-v1'); assert.equal(asked[0].audience, GAME);
  assert.ok(asked[0].expiresAt - T0 / 1000 > 0 && asked[0].expiresAt - T0 / 1000 <= 120);
  assert.equal(asked[0].state, new URL(back).searchParams.get('state'));
  assert.equal(sha(identity.exchanges[0].codeVerifier), asked[0].codeChallenge);
});

test('a linked guest is the account until the bound, and itself again after an unlink', async () => {
  const clock = { t: T0 }, identity = standIn(clock), seen = [], { host, accounts, sessions, guestAccounts } = game(clock, identity);
  const b = browser(host, seen), key = 'browser-key-linked', guestDid = identity.guestDid(key);
  const accountDid = identity.link(key, 'u-pk-0123456789ab');
  await arrive(b, identity, key);
  const linked = (await collect(b)).json(), claims = sessions.read(linked.token);
  assert.equal(linked.linked, true);
  assert.equal(claims.guestSubjectDid, accountDid, 'attributed to the account'); assert.equal(claims.guestDid, guestDid, 'the guest that arrived is kept');
  assert.equal(linked.acct.id, generalGuestAccountId(accountDid)); assert.notEqual(linked.acct.id, generalGuestAccountId(guestDid));
  assert.equal(claims.exp, T0 + LINKED_GUEST_SESSION_MS, 'about ten minutes'); assert.equal(LINKED_GUEST_SESSION_MS, 600_000);
  const client = { acct: accounts[linked.acct.id], authClaims: claims };
  assert.equal(guestAccounts.principalFor(client), accountDid);
  assert.equal(guestAccounts.mayDelete(client), false, 'a linked guest\'s browser cannot delete the account\'s character');
  // The owner unlinks. The game is not told: the session it made ends at its bound, and not before.
  identity.unlink(key);
  clock.t = T0 + LINKED_GUEST_SESSION_MS - 1;
  assert.equal(guestAccounts.principalFor(client), accountDid);
  clock.t = T0 + LINKED_GUEST_SESSION_MS;
  assert.equal(sessions.read(linked.token), null); assert.equal(guestAccounts.principalFor(client), null);
  assert.equal(guestAccounts.accountFor(claims), null, 'the ended session enters no account');
  // Back through the door, the same browser is itself: its own account, its own bound, and it may delete its own character.
  await arrive(b, identity, key);
  const own = (await collect(b)).json(), ownClaims = sessions.read(own.token);
  assert.equal(own.linked, false); assert.equal(ownClaims.guestSubjectDid, guestDid); assert.equal(own.acct.id, generalGuestAccountId(guestDid));
  assert.ok(ownClaims.exp > clock.t + LINKED_GUEST_SESSION_MS);
  assert.equal(guestAccounts.mayDelete({ acct: accounts[own.acct.id], authClaims: ownClaims }), true);
  // A second linked browser of the same account plays the same account character.
  identity.link('browser-key-second', 'u-pk-0123456789ab');
  const second = browser(host, seen); await arrive(second, identity, 'browser-key-second');
  assert.equal((await collect(second)).json().acct.id, linked.acct.id);
});

test('a session is never past the guest\'s own deadline', async () => {
  const clock = { t: T0 }, identity = standIn(clock), { host, sessions } = game(clock, identity), b = browser(host, []), key = 'key-late';
  identity.guestDid(key); clock.t = T0 + 86_400_000 - 120_000; // two minutes of standing left
  identity.link(key, 'u-pk-0123456789ab');
  await arrive(b, identity, key);
  assert.equal(sessions.read((await collect(b)).json().token).exp, T0 + 86_400_000);
  const standing = { ownerDid: USERS + 'g', guestExpiresAt: T0 + 3_600_000, attributes: { subject: USERS + 'g', provisional: true } };
  assert.deepEqual(guestSessionStanding(standing, T0, 14_400_000), { subject: USERS + 'g', linked: false, guestDid: USERS + 'g', expiresAt: T0 + 3_600_000, guestExpiresAt: T0 + 3_600_000 });
  assert.equal(guestSessionStanding(standing, T0, 60_000).expiresAt, T0 + 60_000);
  assert.throws(() => guestSessionStanding(standing, T0 + 3_600_000, 60_000), /guest_door_exchange_refused/);
  assert.throws(() => guestSessionStanding({ ...standing, attributes: { ...standing.attributes, subject: USERS + 'h' } }, T0, 60_000), /guest_door_exchange_refused/);
});

test('game sessions for a general guest are their own bounded kind', () => {
  const clock = { t: T0 }, now = () => clock.t, sessions = createGameSessionTokens({ secret: 'fixture-session-secret', now });
  const guest = USERS + 'u-try-guest-' + 'a'.repeat(32), account = USERS + 'u-pk-0123456789ab';
  const own = sessions.issueGeneralGuest(generalGuestAccountId(guest), { subjectDid: guest, guestDid: guest, expiresAt: T0 + 7 * 86_400_000 });
  assert.equal(own.expiresAt, T0 + 86_400_000, 'never longer than a day');
  const linked = sessions.issueGeneralGuest(generalGuestAccountId(account), { subjectDid: account, guestDid: guest, linked: true, expiresAt: T0 + 86_400_000 });
  assert.equal(linked.expiresAt, T0 + 600_000, 'a linked session is capped at ten minutes whatever is asked');
  assert.equal(sessions.read(linked.token).linked, true);
  for (const token of [own.token, linked.token]) {
    assert.equal(sessions.readForReauthentication(token), null); assert.equal(sessions.readForProvisionalProof(token), null);
  }
  assert.throws(() => sessions.issueGeneralGuest('gg-x', { subjectDid: guest, guestDid: guest, linked: true, expiresAt: T0 + 1000 }), /General guest/);
  assert.throws(() => sessions.issueGeneralGuest('gg-x', { subjectDid: account, guestDid: guest, expiresAt: T0 + 1000 }), /General guest/);
  assert.throws(() => sessions.issueGeneralGuest('gg-x', { subjectDid: guest, guestDid: guest, expiresAt: T0 }), /expiry/);
  const [body] = own.token.split('.'), forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url')), exp: T0 + 9e9 })).toString('base64url');
  assert.equal(sessions.read(forged + '.' + own.token.split('.')[1]), null);
  assert.equal(createGameSessionTokens({ secret: 'another-secret', now }).read(own.token), null);
  // A long-lived legacy bearer for a guest's account is no guest session, and enters no guest account.
  const accounts = {}, guestAccounts = createGeneralGuestAccounts({ accounts, sessions, now });
  const legacy = sessions.read(sessions.issueLegacy(generalGuestAccountId(guest)));
  assert.equal(legacy.generalGuest, undefined); assert.equal(guestAccounts.accountFor(legacy), null);
  assert.equal(guestAccounts.principalFor({ acct: { id: legacy.id, generalGuest: true, guest: true }, authClaims: legacy }), null);
  // A session whose account is not the one its subject derives, or an account that gained a password or an owner, is refused.
  const claims = sessions.read(own.token);
  assert.equal(guestAccounts.accountFor({ ...claims, id: 'gg-' + '0'.repeat(40) }), null);
  assert.ok(guestAccounts.accountFor(claims)); accounts[claims.id].nativeBound = true;
  assert.equal(guestAccounts.accountFor(claims), null);
});

test('the door is off unless the switch is exactly 1, and loud when a prerequisite is missing', () => {
  const ready = { publicOrigin: GAME, publicOriginConfigured: true, identityOrigin: ISSUER, signGrant: async () => ({}), issueSession: () => ({}), fetch: async () => new Response('{}') };
  for (const value of [undefined, '', '0', 'true', 'on', ' 1', '1 ']) {
    assert.equal(configuredGeneralGuest({ ...ready, env: { HM_GENERAL_GUEST: value, HM_GENERAL_GUEST_DOOR_ORIGIN: DOOR } }), null, String(value));
  }
  const on = { HM_GENERAL_GUEST: '1', HM_GENERAL_GUEST_DOOR_ORIGIN: DOOR, HM_GENERAL_GUEST_DIRECT: '1' };
  assert.throws(() => configuredGeneralGuest({ ...ready, env: { HM_GENERAL_GUEST: '1' } }), /HM_GENERAL_GUEST=1: HM_GENERAL_GUEST_DOOR_ORIGIN is not set/);
  assert.throws(() => configuredGeneralGuest({ ...ready, env: { ...on, HM_GENERAL_GUEST_DOOR_ORIGIN: 'http://door.identity.example' } }), /HM_GENERAL_GUEST=1: The door origin must be an HTTPS origin/);
  assert.throws(() => configuredGeneralGuest({ ...ready, env: { ...on, HM_GENERAL_GUEST_DOOR_ORIGIN: DOOR + '/guest/door' } }), /HM_GENERAL_GUEST=1: The door origin/);
  assert.throws(() => configuredGeneralGuest({ ...ready, env: on, publicOriginConfigured: false }), /HM_GENERAL_GUEST=1: this deployment's public origin is not configured/);
  assert.throws(() => configuredGeneralGuest({ ...ready, env: on, publicOrigin: 'http://game.example' }), /HM_GENERAL_GUEST=1: The application audience/);
  assert.throws(() => configuredGeneralGuest({ ...ready, env: on, signGrant: null }), /HM_GENERAL_GUEST=1: the game's service agent is unavailable/);
  assert.throws(() => configuredGeneralGuest({ ...ready, env: on, identityOrigin: 'identity' }), /HM_GENERAL_GUEST=1: The identity origin/);
  const host = configuredGeneralGuest({ ...ready, env: on });
  assert.deepEqual(host.manifest(), { enabled: true, startPath: START, returnPath: RETURN, sessionPath: SESSION, doorOrigin: DOOR });
  assert.deepEqual(host.paths, { start: START, return: RETURN, session: SESSION });
  // The one return path has the shape identity registers.
  assert.match(host.paths.return, /^\/[A-Za-z0-9._~/-]{0,127}$/);
  for (const bad of ['guest/return', '/guest//return', '/guest/../return', '/guest/return?x=1', '/guest/return#x', '/' + 'a'.repeat(128), 7]) {
    assert.throws(() => generalGuestPath(bad), /plain path/, String(bad));
  }
});

test('the routes answer only their own methods, host and origin, and nothing else is theirs', async () => {
  const clock = { t: T0 }, identity = standIn(clock), seen = [], { host } = game(clock, identity), b = browser(host, seen);
  assert.equal((await b.visit('GET', '/')).handled, false); assert.equal((await b.visit('GET', '/guest/general')).handled, false);
  assert.equal((await b.visit('GET', '/gaming/identity/status')).handled, false);
  assert.equal((await b.visit('POST', START)).status, 405); assert.equal((await b.visit('POST', RETURN)).status, 405);
  assert.equal((await b.visit('GET', SESSION)).status, 405);
  assert.equal((await b.visit('GET', START, { hostHeader: 'attacker.example' })).status, 403);
  await arrive(b, identity, 'key-routes');
  // A cross-site post cannot collect, and does not spend the arrival.
  assert.equal((await b.visit('POST', SESSION, { origin: 'https://attacker.example' })).status, 403);
  assert.equal((await b.visit('POST', SESSION)).status, 403);
  assert.equal((await collect(b)).status, 200);
  // A return with anything but one code and one state is not a return.
  const c = browser(host, seen), started = await c.visit('GET', START), back = identity.page('key-extra', started.headers.Location);
  assert.equal((await c.visit('GET', pathOf(back) + '&next=https://attacker.example')).headers.Location, GAME + '/?interego-guest=refused');
  assert.equal((await c.visit('GET', pathOf(back))).headers.Location, GAME + '/?interego-guest=arrived');
  // Closed, the door answers nothing useful.
  host.close();
  assert.equal((await b.visit('GET', START)).status, 503); assert.equal(host.manifest().enabled, false);
});

test('a browser holds one visit, and visits and arrivals are bounded', async () => {
  const clock = { t: T0 }, identity = standIn(clock);
  const door = createGeneralGuestDoor({ identityOrigin: ISSUER, doorOrigin: DOOR, audience: GAME, signGrant: identity.signAs(), fetch: identity.fetch, now: () => clock.t, maxVisits: 2 });
  const host = createGeneralGuestHost({ door, publicOrigin: GAME, now: () => clock.t, issueSession: () => { throw new Error('not reached'); } });
  const b = browser(host, []);
  await b.visit('GET', START); await b.visit('GET', START); await b.visit('GET', START);
  assert.equal(door.status().visits, 1, 'starting again gives up the visit it had');
  const others = [browser(host, []), browser(host, [])];
  assert.ok((await others[0].visit('GET', START)).headers.Location.startsWith(DOOR));
  assert.equal((await others[1].visit('GET', START)).headers.Location, GAME + '/?interego-guest=busy');
  clock.t += 10 * 60_000; // visits lapse
  assert.ok((await others[1].visit('GET', START)).headers.Location.startsWith(DOOR));
  assert.throws(() => createGeneralGuestHost({ door, publicOrigin: OTHER, issueSession: () => ({}) }), /audience/);
});

test('attributes are read whole or not at all', () => {
  const facts = { subject: USERS + 'g', provisional: true, claimed: false, establishedAt: T0 / 1000, standingUntil: T0 / 1000 + 60, admittedBy: [GAME] };
  assert.equal(subjectFacts(facts), facts); assert.equal(provisionalMayUse(facts, GAME, T0), true);
  assert.equal(provisionalMayUse(facts, OTHER, T0), false); assert.equal(provisionalMayUse(facts, GAME, T0 + 60_000), false);
  assert.equal(provisionalMayUse({ ...facts, provisional: false }, GAME, T0), false);
  assert.equal(provisionalMayUse({ ...facts, admittedBy: undefined }, GAME, T0), false);
  for (const bad of [null, [], { ...facts, subject: 'has space' }, { ...facts, provisional: 'true' }, { ...facts, standingUntil: T0 / 1000 - 1 },
    { ...facts, admittedBy: [GAME, GAME] }, { ...facts, admittedBy: ['game.example'] }, { ...facts, linkedTo: facts.subject }, { ...facts, extra: 1 }]) {
    assert.equal(subjectFacts(bad), null); assert.equal(provisionalMayUse(bad, GAME, T0), false);
  }
});

test('starts are bounded for each client address, then for all; a guest is issued a bounded number of sessions', async () => {
  const clock = { t: T0 }, identity = standIn(clock);
  const door = createGeneralGuestDoor({ identityOrigin: ISSUER, doorOrigin: DOOR, audience: GAME, signGrant: identity.signAs(), fetch: identity.fetch, now: () => clock.t });
  const accounts = {}, sessions = createGameSessionTokens({ secret: 'fixture-session-secret', now: () => clock.t });
  const guestAccounts = createGeneralGuestAccounts({ accounts, sessions, now: () => clock.t });
  const host = createGeneralGuestHost({ door, publicOrigin: GAME, now: () => clock.t, issueSession: standing => guestAccounts.issue(standing),
    startsPerMinute: 3, startsPerMinuteAll: 5, sessionsPerGuest: 2 });
  const noisy = browser(host, []), quiet = browser(host, []);
  for (let n = 0; n < 3; n++) assert.ok((await noisy.visit('GET', START, { address: '198.51.100.1' })).headers.Location.startsWith(DOOR));
  assert.equal((await noisy.visit('GET', START, { address: '198.51.100.1' })).headers.Location, GAME + '/?interego-guest=busy', 'one address is held to its own share');
  assert.ok((await quiet.visit('GET', START, { address: '198.51.100.2' })).headers.Location.startsWith(DOOR), 'another address is not held by it');
  assert.ok((await browser(host, []).visit('GET', START, { address: '198.51.100.3' })).headers.Location.startsWith(DOOR));
  assert.equal((await browser(host, []).visit('GET', START, { address: '198.51.100.4' })).headers.Location, GAME + '/?interego-guest=busy', 'the ceiling for all still holds');
  assert.equal(host.status().limited, 1);
  clock.t += 61_000;
  // One guest, from changing addresses: two sessions in ten minutes, and the third is refused after its code is spent.
  for (let n = 0; n < 3; n++) {
    const b = browser(host, []), started = await b.visit('GET', START, { address: '198.51.100.' + (10 + n) });
    const returned = await b.visit('GET', pathOf(identity.page('one-guest-key', started.headers.Location)), { address: '198.51.100.' + (10 + n) });
    assert.equal(returned.headers.Location, GAME + '/?interego-guest=' + (n < 2 ? 'arrived' : 'busy'));
  }
  clock.t += 601_000;
  const later = browser(host, []), again = await later.visit('GET', START);
  assert.equal((await later.visit('GET', pathOf(identity.page('one-guest-key', again.headers.Location)))).headers.Location, GAME + '/?interego-guest=arrived');
  assert.throws(() => createGeneralGuestHost({ door, publicOrigin: GAME, issueSession: () => ({}), startsPerMinuteAll: 200 }), /bounded/);
});

test('another site cannot start a visit, and the deployment names the header its proxy states the client by', async () => {
  const clock = { t: T0 }, identity = standIn(clock), { host } = game(clock, identity, { env: { HM_GENERAL_GUEST: '1', HM_GENERAL_GUEST_DOOR_ORIGIN: DOOR,
    HM_GENERAL_GUEST_CLIENT_IP_HEADER: 'x-real-ip' } });
  for (const site of ['cross-site', 'same-site']) {
    const b = browser(host, []), refused = await b.visit('GET', START, { headers: { 'sec-fetch-site': site } });
    assert.equal(refused.headers.Location, GAME + '/?interego-guest=refused'); assert.equal(b.cookie, null, 'no visit was bound');
  }
  for (const site of ['same-origin', 'none']) assert.ok((await browser(host, []).visit('GET', START, { headers: { 'sec-fetch-site': site } })).headers.Location.startsWith(DOOR));
  // Six a minute for one stated address, whatever socket (the proxy's) it arrives on; a malformed statement falls back to the socket.
  for (let n = 0; n < 6; n++) assert.ok((await browser(host, []).visit('GET', START, { headers: { 'x-real-ip': '192.0.2.44' } })).headers.Location.startsWith(DOOR));
  assert.equal((await browser(host, []).visit('GET', START, { headers: { 'x-real-ip': '192.0.2.44' } })).headers.Location, GAME + '/?interego-guest=busy');
  assert.ok((await browser(host, []).visit('GET', START, { headers: { 'x-real-ip': '192.0.2.45' } })).headers.Location.startsWith(DOOR));
  assert.ok((await browser(host, []).visit('GET', START, { address: '192.0.2.99', headers: { 'x-real-ip': 'not an address' } })).headers.Location.startsWith(DOOR));
  assert.throws(() => game(clock, identity, { env: { HM_GENERAL_GUEST: '1', HM_GENERAL_GUEST_DOOR_ORIGIN: DOOR, HM_GENERAL_GUEST_CLIENT_IP_HEADER: 'X Real' } }), /CLIENT_IP_HEADER/);
});

test('the door does not start without knowing how its clients are told apart, and reads a forwarded list from the trusted end', async () => {
  const clock = { t: T0 }, identity = standIn(clock), on = { HM_GENERAL_GUEST: '1', HM_GENERAL_GUEST_DOOR_ORIGIN: DOOR };
  // Neither a header nor the statement that there is no proxy: every player would share the proxy's one bucket.
  for (const env of [on, { ...on, HM_GENERAL_GUEST_CLIENT_IP_HEADER: '' }, { ...on, HM_GENERAL_GUEST_DIRECT: 'true' }, { ...on, HM_GENERAL_GUEST_DIRECT: '0' }]) {
    assert.throws(() => game(clock, identity, { env }), /HM_GENERAL_GUEST=1: HM_GENERAL_GUEST_CLIENT_IP_HEADER is not set/);
  }
  assert.ok(game(clock, identity, { env: { ...on, HM_GENERAL_GUEST_DIRECT: '1' } }).host);
  for (const hops of ['0', '-1', '1.5', 'two', '17', ' 1']) {
    assert.throws(() => game(clock, identity, { env: { ...on, HM_GENERAL_GUEST_CLIENT_IP_HEADER: 'x-forwarded-for', HM_GENERAL_GUEST_CLIENT_IP_HOPS: hops } }), /CLIENT_IP_HOPS/, hops);
  }
  const start = (host, list, address) => browser(host, []).visit('GET', START, { address, headers: { 'x-forwarded-for': list } });
  // One trusted proxy (the default): the right-most entry is the one it appended. What the client wrote to its left is not read.
  const one = game(clock, identity, { env: { ...on, HM_GENERAL_GUEST_CLIENT_IP_HEADER: 'x-forwarded-for' } }).host;
  for (let n = 0; n < 6; n++) assert.ok((await start(one, `10.9.9.${n}, 192.0.2.44`)).headers.Location.startsWith(DOOR));
  assert.equal((await start(one, '10.1.2.3 , 192.0.2.44')).headers.Location, GAME + '/?interego-guest=busy', 'a forged left-most entry buys no new bucket');
  assert.ok((await start(one, '192.0.2.44, 192.0.2.45')).headers.Location.startsWith(DOOR), 'and holds nobody else');
  assert.equal((await start(one, '192.0.2.44')).headers.Location, GAME + '/?interego-guest=busy', 'a single value is its own right-most entry');
  // Two trusted proxies: the second from the right.
  const two = game(clock, identity, { env: { ...on, HM_GENERAL_GUEST_CLIENT_IP_HEADER: 'x-forwarded-for', HM_GENERAL_GUEST_CLIENT_IP_HOPS: '2' } }).host;
  for (let n = 0; n < 6; n++) assert.ok((await start(two, `10.9.9.${n}, 198.51.100.7, 172.16.0.${n}`)).headers.Location.startsWith(DOOR));
  assert.equal((await start(two, '198.51.100.7, 172.16.0.9')).headers.Location, GAME + '/?interego-guest=busy');
  assert.ok((await start(two, '198.51.100.7, 198.51.100.8, 172.16.0.9')).headers.Location.startsWith(DOOR));
  // A list shorter than the trusted hops, or an entry that is no address, names nobody: the socket's address, never another entry.
  for (let n = 0; n < 6; n++) assert.ok((await start(two, '198.51.100.99', '192.0.2.200')).headers.Location.startsWith(DOOR));
  assert.equal((await start(two, '203.0.113.1', '192.0.2.200')).headers.Location, GAME + '/?interego-guest=busy');
  assert.equal((await start(two, 'unknown, 172.16.0.1', '192.0.2.200')).headers.Location, GAME + '/?interego-guest=busy');
});

test('identity\'s token for the guest leaves the door only where the pod is configured, apart from the standing, and never for a linked guest', async () => {
  const clock = { t: T0 }, identity = standIn(clock), given = [];
  const plainGame = game(clock, identity, { issueSession: (standing, pod) => { given.push([standing, pod]); return plainGame.guestAccounts.issue(standing); } });
  await arrive(browser(plainGame.host, []), identity, 'key-a');
  assert.equal(given[0][1], null); assert.equal(plainGame.host.manifest().pod, undefined);
  assert.ok(!JSON.stringify(given[0][0]).includes(IDENTITY_TOKEN));
  const podGame = game(clock, identity, { pod: 'shadow', issueSession: (standing, pod) => { given.push([standing, pod]); return podGame.guestAccounts.issue(standing); } });
  assert.equal(podGame.host.manifest().pod, 'shadow');
  const key = 'key-b', b = browser(podGame.host, []), seen = [];
  await arrive(b, identity, key);
  const [standing, pod] = given[1], userId = identity.guestDid(key).slice(USERS.length);
  assert.deepEqual(pod, { token: IDENTITY_TOKEN, tokenExpiresAt: new Date(T0 + 3_600_000).toISOString(), podUrl: `https://pods.example/${userId}/`, namespace: 'game' });
  assert.ok(!JSON.stringify(standing).includes(IDENTITY_TOKEN)); assert.equal(standing.guestExpiresAt, T0 + 86_400_000);
  assert.ok(!JSON.stringify((await collect(b)).json()).includes(IDENTITY_TOKEN), 'the page is never given it');
  identity.link('key-c', 'u-pk-0123456789ab');
  await arrive(browser(podGame.host, seen), identity, 'key-c');
  assert.equal(given[2][0].linked, true); assert.equal(given[2][1], null, 'a linked guest plays an account\'s character: its pod token is dropped');
  assert.throws(() => game(clock, identity, { pod: 'everything' }), /bounded/);
});

test('a guest\'s server-held character is swept after the guest\'s own deadline; an account\'s only when long unused', () => {
  const day = 86_400_000, id = n => 'gg-' + String(n).repeat(40);
  const accounts = {
    [id(1)]: { id: id(1), generalGuest: true, guest: true, created: T0, last: T0, guestUntil: T0 + day },
    [id(2)]: { id: id(2), generalGuest: true, guest: true, created: T0, last: T0 + 6 * day },                       // made before deadlines were kept
    [id(3)]: { id: id(3), generalGuest: true, guest: true, created: T0, last: T0 + 2 * day, linked: true },
    [id(4)]: { id: id(4), generalGuest: true, guest: true, created: T0, last: T0, guestUntil: T0 + 4000 * day },     // a deadline no guest has
    gabc: { id: 'gabc', guest: true, created: 0, last: 0 }, aNamed: { id: 'aNamed', name: 'Named', pass: {}, created: 0, last: 0 },
    [id(5)]: { id: id(6), generalGuest: true, guest: true, created: 0, last: 0 },                                    // not its own record
  };
  const at = now => generalGuestSweep({ accounts, now }).sort();
  assert.deepEqual(at(T0 + day + 3_599_000), []);
  assert.deepEqual(at(T0 + day + 3_601_000), [id(1)]);
  assert.deepEqual(at(T0 + 7 * day + 3_601_000), [id(1), id(4)], 'never longer than a guest can live');
  assert.deepEqual(at(T0 + 13 * day + 3_601_000), [id(1), id(2), id(4)]);
  assert.deepEqual(at(T0 + 93 * day), [id(1), id(2), id(4)]);
  assert.deepEqual(at(T0 + 4000 * day), [id(1), id(2), id(4)], 'a registered account\'s character is never swept unless the deployment opts in');
  assert.deepEqual(generalGuestSweep({ accounts, now: T0 + 4000 * day, linkedIdleMs: null }).sort(), [id(1), id(2), id(4)]);
  assert.deepEqual(generalGuestSweep({ accounts, now: T0 + 20 * day, linkedIdleMs: 10 * day }).sort(), [id(1), id(2), id(3), id(4)]);
  assert.throws(() => generalGuestSweep({ accounts, now: T0, linkedIdleMs: 1000 }), /bounded/);
  for (const odd of [0, -1, NaN, Infinity, '90']) assert.throws(() => generalGuestSweep({ accounts, now: T0, linkedIdleMs: odd }), /bounded/, String(odd));
});

test('a save with no account entry is judged by its own record, and with none it is kept', () => {
  const day = 86_400_000, id = n => 'gg-' + String(n).repeat(40);
  assert.deepEqual(generalGuestSaveRecord({ id: id(1), name: 'Synthetic', generalGuest: true, guest: true, created: T0, last: T0 + 5, guestUntil: T0 + day + 0.5, pod: { writes: 1 } }),
    { v: 1, id: id(1), linked: false, guestUntil: T0 + day, last: T0 + 5 });
  assert.deepEqual(generalGuestSaveRecord({ id: id(2), generalGuest: true, guest: true, linked: true, created: T0, last: T0, guestUntil: T0 + day }),
    { v: 1, id: id(2), linked: true, guestUntil: null, last: T0 }, 'an account\'s character has no guest\'s deadline');
  for (const other of [null, {}, { id: 'gplain', guest: true }, { id: 'aNamed', generalGuest: true }, { id: id(1), guest: true }]) assert.equal(generalGuestSaveRecord(other), null);
  const unlinked = { v: 1, id: id(1), linked: false, guestUntil: T0 + day, last: T0 }, linked = { v: 1, id: id(2), linked: true, guestUntil: null, last: T0 };
  const records = { [id(1)]: unlinked, [id(2)]: linked, [id(3)]: { v: 1, id: id(3), linked: false, guestUntil: null, last: T0 },
    [id(4)]: null, [id(5)]: 'text', [id(6)]: { ...unlinked }, [id(7)]: { v: 2, id: id(7), linked: false, guestUntil: 1, last: 1 },
    [id(8)]: { v: 1, id: id(8), guestUntil: 1, last: 1 }, [id(9)]: { v: 1, id: id(9), linked: true, guestUntil: 1, last: 1 },
    gplain: { v: 1, id: 'gplain', linked: false, guestUntil: 1, last: 1 }, [id(0)]: { v: 1, id: id(0), linked: false, guestUntil: 1, last: 0 } };
  const unrecorded = [id(0), id(4), id(5), id(6), id(7), id(8), id(9), 'gplain'].sort();
  const at = (now, more = {}) => { const judged = generalGuestOrphans({ records, now, ...more }); return [judged.gone.sort(), judged.unrecorded.sort()]; };
  assert.deepEqual(at(T0 + day + 3_599_000), [[], unrecorded]);
  assert.deepEqual(at(T0 + day + 3_601_000), [[id(1)], unrecorded], 'an hour after the guest\'s own deadline');
  assert.deepEqual(at(T0 + 7 * day + 3_601_000), [[id(1), id(3)], unrecorded], 'with no deadline kept, a guest\'s longest life');
  assert.deepEqual(at(T0 + 40_000 * day), [[id(1), id(3)], unrecorded], 'neither an account\'s character nor an unrecorded save, at any age');
  assert.deepEqual(at(T0 + 40 * day, { linkedIdleMs: 10 * day }), [[id(1), id(2), id(3)], unrecorded]);
  assert.throws(() => generalGuestOrphans({ now: T0 }), /required/);
  assert.throws(() => generalGuestOrphans({ records: {}, now: T0, linkedIdleMs: 5 }), /bounded/);
});
