import test from 'node:test';
import assert from 'node:assert/strict';
import { nativeIdentityDescription } from './native-identity-description.js';

test('the owned capability exports all twelve native-discoverable owner, guest and claim actions with matching HTTP and schema references', () => {
  const value = nativeIdentityDescription({ publicOrigin: 'https://app.example', allowOwnerBrowserHandoff: true });
  const operations = value.description['hydra:supportedOperation'];
  assert.equal(operations.length, 12);
  assert.deepEqual(operations.map(op => [op['iep:action']['@id'], op['hydra:method'], op['hydra:target']]), [
    ['urn:interego:identity:owner:playChallenge', 'POST', 'https://app.example/gaming/identity/play/challenge'],
    ['urn:interego:identity:owner:playComplete', 'POST', 'https://app.example/gaming/identity/play/complete'],
    ['urn:interego:identity:owner:claimChallenge', 'POST', 'https://app.example/gaming/identity/play/claim-challenge'],
    ['urn:interego:identity:owner:claimOwnerStart', 'POST', 'https://app.example/gaming/identity/claim-owner/start'],
    ['urn:interego:identity:owner:claimOwnerClaim', 'POST', 'https://app.example/gaming/identity/claim-owner/claim'],
    ['urn:interego:identity:owner:claimComplete', 'POST', 'https://app.example/gaming/identity/play/claim-complete'],
    ['urn:interego:identity:owner:claimRecoveryChallenge', 'POST', 'https://app.example/gaming/identity/play/claim-recovery-challenge'],
    ['urn:interego:identity:owner:start', 'POST', 'https://app.example/gaming/identity/start'],
    ['urn:interego:identity:owner:status', 'GET', 'https://app.example/gaming/identity/status'],
    ['urn:interego:identity:owner:recoveryStatus', 'GET', 'https://app.example/gaming/identity/recovery-status'],
    ['urn:interego:identity:owner:claim', 'POST', 'https://app.example/gaming/identity/claim'],
    ['urn:interego:identity:owner:recordLink', 'POST', 'https://app.example/gaming/identity/record-link'],
  ]);
  for (const op of operations) {
    assert(value.graphContent.includes(`iep:action <${op['iep:action']['@id']}>`));
    assert(value.graphContent.includes(`hydra:target <${op['hydra:target']}>`));
    for (const field of ['hydra:expects', 'hydra:returns']) if (op[field]) {
      const name = op[field]['@id'].split('#').at(-1);
      assert(value.schemas.$defs[name]); assert(value.graphContent.includes(`<${op[field]['@id']}> a schema:CreativeWork`));
    }
    assert(op['dct:requires'].length > 0);
  }
  assert.equal(value.manifest.capability, value.id); assert.equal(value.manifest.ownerBrowserWriteHandoff, true);
  assert.equal(value.manifest.nativePublication, 'requires-verified-owned-descriptor');
  assert(value.graphContent.includes('sh:name "ownerPodWriteAccess" ; sh:datatype xsd:boolean'));
  const defs = value.schemas.$defs;
  assert.equal(defs.PlayCompleteResponse.properties.provisional.const, true);
  assert.equal(defs.ClaimOwnerResponse.properties.appSession.properties.purpose.const, 'character-claim-target');
  assert.equal(defs.ClaimOwnerResponse.properties.appSession.properties.token, undefined);
  assert.equal(defs.ClaimCompleteRequest.properties.readConfirmed.const, true);
  assert.equal(defs.ClaimCompleteRequest.properties.recoveryChallenge.maxLength, 128);
  assert.equal(defs.ClaimRecoveryChallengeRequest.additionalProperties, false);
  assert.equal(defs.ClaimRecoveryChallengeRequest.properties.attestation, undefined);
  assert.match(operations.find(op => op['iep:action']['@id'].endsWith(':claimRecoveryChallenge'))['hydra:description'], /two-minute random challenge/);
  assert.deepEqual(defs.ClaimCompleteRequest.properties.selection.enum, ['copy-guest', 'use-existing']);
  assert.equal(defs.ClaimCompleteResponse.properties.provisional.const, false);
  assert.match(operations.find(op => op['iep:action']['@id'].endsWith(':playComplete'))['hydra:description'], /human-only/);
  assert.match(operations.find(op => op['iep:action']['@id'].endsWith(':claimComplete'))['hydra:description'], /not proof for authoritative rewards or loot/);
});

test('schemas preserve explicit browser write consent and permit no refresh token in handoff output', () => {
  const value = nativeIdentityDescription({ publicOrigin: 'https://app.example' });
  const defs = value.schemas.$defs;
  assert.equal(defs.StartRequest.properties.ownerPodWriteAccess.default, false);
  assert.match(defs.ClaimRequest.description, /required again/);
  const native = defs.ClaimResponse.properties.nativeSession;
  assert.equal(native.additionalProperties, false); assert.equal(native.properties.refreshToken, undefined);
  assert.equal(native.properties.accessToken.maxLength, 16384);
  assert.equal(defs.RecordLinkRequest.properties.kind.const, 'character');
  assert.equal(defs.RecordLinkRequest.properties.graphIri.maxLength, 1024);
  assert.match(defs.RecordLinkRequest.description, /no save body/);
  assert.equal(defs.RecordLinkResponse.properties.pointer.additionalProperties, false);
  assert.deepEqual(defs.StatusResponse.properties.saveAuthority.enum, ['player-pod', 'legacy-server']);
  assert.equal(value.manifest.nativeTeamMigration, false); assert.equal(value.manifest.nativeAgentDelegation, false);
  assert.equal(Object.isFrozen(defs.ClaimResponse.properties.nativeSession), true);
});

test('recovery discovery advertises a read-only owner proof contract and no native save verification claim', () => {
  const value = nativeIdentityDescription({ publicOrigin: 'https://app.example' });
  const operation = value.description['hydra:supportedOperation'].find(op => op['iep:action']['@id'].endsWith(':recoveryStatus'));
  assert.equal(operation['hydra:method'], 'GET'); assert.equal(operation['hydra:expects'], undefined);
  assert.equal(operation['hydra:target'], 'https://app.example/gaming/identity/recovery-status');
  assert.deepEqual(operation['dct:requires'].map(x => x['@id'].split('/').at(-1)), ['account', 'native']);
  assert.match(operation['hydra:description'], /Creates no key, import, checkpoint or save mutation/);
  assert.match(operation['hydra:description'], /does not prove the owner pod has no saved character/);
  const response = value.schemas.$defs.RecoveryStatusResponse;
  assert.equal(response.additionalProperties, false); assert.equal(response.properties.readOnly.const, true);
  assert.deepEqual(response.properties.owner.required, ['accountId', 'subjectDid', 'podUrl']);
  assert.equal(response.properties.legacySave.properties.authoritative.const, false);
  assert.equal(response.properties.nativeRecord.properties.verified.const, false);
  assert.equal(response.properties.nativeRecord.properties.hintOnly.const, true);
  assert.match(response.properties.nativeRecord.description, /not fetched, decrypted or verified/);
});

test('public metadata carries transport prerequisites and truthful migration and pointer limits without player instances', () => {
  const value = nativeIdentityDescription({ publicOrigin: 'https://app.example' });
  const graph = value.graphContent;
  for (const required of ['Secure HttpOnly SameSite=Lax', 'S256 PKCE', 'at most 30 seconds', 'pod-wide grant',
    'at most one hour', 'Learning export requires', 'not migrated', 'Does not fetch the descriptor', 'not a signed descriptor']) {
    // Authorship is described as publisher work, rather than a local claim.
    assert(graph.includes(required) || (required === 'not a signed descriptor' && graph.includes('only after a native publisher signs')));
  }
  assert(!graph.includes('css.railway.internal')); assert(!graph.includes('u-pk-')); assert(!graph.includes('access_token='));
  assert(!graph.includes('hallowmarch')); assert(!graph.includes('native-access-secret'));
});

test('description origins and custom routes cannot inject RDF or redirect credential forms', () => {
  for (const publicOrigin of ['http://app.example', 'https://name:secret@app.example', 'https://app.example/path', 'https://app.example/?x=1']) {
    assert.throws(() => nativeIdentityDescription({ publicOrigin }));
  }
  for (const paths of [{ start: '//evil.example/path' }, { start: '/bad>route' }, { claim: '/gaming/identity/start' }, { status: '/identity/../other' }]) {
    assert.throws(() => nativeIdentityDescription({ publicOrigin: 'https://app.example', paths }));
  }
});
