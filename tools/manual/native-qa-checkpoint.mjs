/** Opt-in, synthetic manual QA only. Never stores browser sessions or live tokens.
 * The caller must durably record each intent BEFORE its corresponding mutation.
 * A checkpoint is recovery material, never evidence that a QA stage passed. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, createPrivateKey, randomUUID } from 'node:crypto';

const SCHEMA = 'hallowmarch.native-qa-checkpoint/v1', FILE = 'checkpoint.json', LOCK = 'writer.lock';
const MAX_BYTES = 64 * 1024, UUID = '[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const uuid = new RegExp('^' + UUID + '$'), uuidUrn = new RegExp('^urn:uuid:' + UUID + '$');
const scopeKeys = ['gameOrigin', 'relayOrigin', 'identityOrigin', 'agentDid', 'agentPodUrl'];
const fixtureKeys = ['run', 'displayName', 'characterName', 'room', ...scopeKeys, 'expectedSave', 'passphrase'];
const credentialKeys = ['credentialId', 'privateKey', 'rpId', 'userHandle', 'isResidentCredential', 'signCount'];
const ownerKeys = ['userId', 'subjectDid', 'podUrl', 'accountId'];
const recoveryKeys = ['format', 'version', 'scope', 'publicKey', 'kdf', 'iterations', 'salt', 'iv', 'ciphertext'];
const lifecycleKeys = ['grantMayExist', 'coachingMayExist', 'grantReference', 'grantRevoked'];
const stateKeys = ['schema', 'version', 'revision', 'fixture', 'registrationIntent', 'credential', 'owner', 'recovery', 'publications', 'lifecycle'];
const failureCodes = new Set(['configuration', 'path_refused', 'permissions_refused', 'writer_conflict', 'exists', 'missing',
  'corrupt', 'scope_mismatch', 'unrecoverable', 'lifecycle_blocked', 'closed', 'write_failed', 'transition_refused'].map(code => 'qa_checkpoint_' + code));
export const nativeQaCheckpointFailureCode = error => {
  try { const code = error?.code; return failureCodes.has(code) ? code : null; } catch { return null; }
};
const fail = code => { throw Object.assign(new Error('Native QA checkpoint refused.'), { code: 'qa_checkpoint_' + code }); };
const ensure = (value, code = 'transition_refused') => { if (!value) fail(code); };
const clone = value => structuredClone(value);
const canonical = value => value && typeof value === 'object' ? Array.isArray(value) ? value.map(canonical)
  : Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const equal = (left, right) => JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
function keys(value, allowed) {
  ensure(plain(value) && Reflect.ownKeys(value).length === allowed.length
    && allowed.every(key => Object.hasOwn(value, key) && Object.getOwnPropertyDescriptor(value, key)?.enumerable
      && Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), 'value')));
}
function text(value, max = 512) {
  ensure(typeof value === 'string' && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value));
  return value;
}
function origin(value) {
  text(value, 2048); let result;
  try { result = new URL(value); } catch { fail('transition_refused'); }
  ensure(result.protocol === 'https:' && result.origin === value && !result.username && !result.password);
  return result;
}
function pod(value) {
  text(value, 2048); let result;
  try { result = new URL(value); } catch { fail('transition_refused'); }
  ensure(result.protocol === 'https:' && result.href === value && !result.username && !result.password
    && !result.search && !result.hash && /^\/[A-Za-z0-9_-]+\/$/.test(result.pathname));
  return result;
}
function base64(value, min, max = min) {
  ensure(typeof value === 'string' && value.length <= Math.ceil(max / 3) * 4
    && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value));
  const bytes = Buffer.from(value, 'base64');
  ensure(bytes.length >= min && bytes.length <= max && bytes.toString('base64') === value);
  return bytes;
}
function validateScope(value) {
  keys(value, scopeKeys);
  for (const key of ['gameOrigin', 'relayOrigin', 'identityOrigin']) origin(value[key]);
  ensure(value.gameOrigin !== value.relayOrigin);
  ensure(/^did:web:[^\s]{1,400}:agents:[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/.test(text(value.agentDid)));
  pod(value.agentPodUrl);
}
function validateSave(value, fixture) {
  keys(value, ['v', 'char', 'settings', 'qa']); ensure(value.v === 1);
  const character = value.char;
  keys(character, ['name', 'realm', 'cls', 'level', 'xp', 'rp', 'kills', 'realmKills', 'deaths', 'played', 'bounty', 'pos',
    'gold', 'potions', 'bag', 'eq', 'lore', 'gift', 'x']);
  ensure(character.name === fixture.characterName && character.realm === 0 && character.cls === 'warrior' && character.level === 1);
  for (const key of ['xp', 'rp', 'kills', 'realmKills', 'deaths', 'played', 'gold', 'potions']) ensure(character[key] === 0);
  for (const key of ['bounty', 'pos', 'lore']) ensure(character[key] === null);
  ensure(Array.isArray(character.bag) && character.bag.length === 0);
  ensure(Reflect.ownKeys(character.bag).length === 1);
  for (const key of ['eq', 'gift', 'x']) keys(character[key], []);
  keys(value.settings, ['quality', 'auto', 'tod', 'sound', 'weather']);
  ensure(equal(value.settings, { quality: 'low', auto: false, tod: 'morning', sound: false, weather: 'clear' }));
  keys(value.qa, ['run', 'privateMarker', 'purpose', 'authoritativeGameOutcome']);
  ensure(value.qa.run === fixture.run && /^private-native-qa-[0-9a-f]{48}$/.test(text(value.qa.privateMarker, 100))
    && value.qa.purpose === 'Synthetic owner-pod persistence verification' && value.qa.authoritativeGameOutcome === false);
}
function validateFixture(value) {
  keys(value, fixtureKeys);
  validateScope(Object.fromEntries(scopeKeys.map(key => [key, value[key]])));
  ensure(/^\d{17}-[0-9a-f]{8}$/.test(text(value.run, 40))
    && value.displayName === 'Hallowmarch QA native E2E ' + value.run
    && value.characterName === 'QA Native ' + value.run.slice(-8) && value.room === 'native-qa-' + value.run.slice(-8));
  ensure(typeof value.passphrase === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value.passphrase)
    && Buffer.from(value.passphrase, 'base64url').length === 32
    && Buffer.from(value.passphrase, 'base64url').toString('base64url') === value.passphrase);
  validateSave(value.expectedSave, value);
}
function validateCredential(value, fixture) {
  keys(value, credentialKeys);
  base64(value.credentialId, 1, 1024); base64(value.userHandle, 1, 256);
  const privateBytes = base64(value.privateKey, 32, 8192);
  try { createPrivateKey({ key: privateBytes, format: 'der', type: 'pkcs8' }); } catch { fail('transition_refused'); }
  ensure([new URL(fixture.relayOrigin).hostname, new URL(fixture.identityOrigin).hostname].includes(value.rpId)
    && value.isResidentCredential === true && Number.isSafeInteger(value.signCount) && value.signCount >= 0 && value.signCount <= 0xffffffff);
}
function validateOwner(value, credential, fixture) {
  keys(value, ownerKeys); ensure(credential);
  const userId = 'u-pk-' + createHash('sha256').update(Buffer.from(credential.credentialId, 'base64').toString('base64url'), 'utf8').digest('hex').slice(0, 12);
  const identity = new URL(fixture.identityOrigin);
  ensure(value.userId === userId && value.subjectDid === 'did:web:' + identity.host.replace(/:/g, '%3A') + ':users:' + userId
    && pod(value.podUrl).pathname === '/' + userId + '/' && /^[A-Za-z0-9._:-]{1,256}$/.test(text(value.accountId, 256)));
}
function validateRecovery(value, owner, fixture) {
  keys(value, recoveryKeys); ensure(owner);
  ensure(value.format === 'interego-client-key' && value.version === 1 && value.kdf === 'PBKDF2-SHA256' && value.iterations === 600000
    && value.scope === JSON.stringify(['interego-client-key/v1', fixture.relayOrigin, owner.subjectDid, owner.userId]));
  base64(value.publicKey, 32); base64(value.salt, 16); base64(value.iv, 12); base64(value.ciphertext, 48);
}
function grantReference(value) {
  keys(value, ['grantId', 'graphIri']);
  ensure(uuidUrn.test(text(value.grantId, 50)) && value.graphIri === 'urn:graph:interego:gaming:owner-agent-grant:' + value.grantId.slice(9));
}
function validatePublication(value, owner) {
  keys(value, ['kind', 'graphIri', 'operationId', 'digest']); ensure(owner);
  ensure(['profile', 'index'].includes(value.kind) && uuid.test(text(value.operationId, 36))
    && /^graph-nquads-sha256:[0-9a-f]{64}$/.test(text(value.digest, 90)));
  text(value.graphIri, 1024);
  ensure(value.kind === 'profile' ? new RegExp('^urn:graph:client-owned:' + UUID + '$').test(value.graphIri)
    : value.graphIri === 'urn:graph:hallowmarch:player-profile-index:' + createHash('sha256').update(owner.subjectDid, 'utf8').digest('hex'));
}
function validateState(value) {
  keys(value, stateKeys); ensure(value.schema === SCHEMA && value.version === 1 && Number.isSafeInteger(value.revision) && value.revision >= 1);
  validateFixture(value.fixture); ensure(typeof value.registrationIntent === 'boolean');
  if (value.credential !== null) { ensure(value.registrationIntent); validateCredential(value.credential, value.fixture); }
  if (value.owner !== null) validateOwner(value.owner, value.credential, value.fixture);
  if (value.recovery !== null) validateRecovery(value.recovery, value.owner, value.fixture);
  ensure(Array.isArray(value.publications) && value.publications.length <= 2);
  if (value.publications.length) ensure(value.recovery);
  for (const entry of value.publications) validatePublication(entry, value.owner);
  ensure(new Set(value.publications.map(entry => entry.kind)).size === value.publications.length
    && new Set(value.publications.map(entry => entry.operationId)).size === value.publications.length);
  keys(value.lifecycle, lifecycleKeys);
  for (const key of ['grantMayExist', 'coachingMayExist', 'grantRevoked']) ensure(typeof value.lifecycle[key] === 'boolean');
  if (value.lifecycle.grantReference !== null) { ensure(value.lifecycle.grantMayExist); grantReference(value.lifecycle.grantReference); }
  if (value.lifecycle.grantMayExist || value.lifecycle.coachingMayExist) ensure(value.owner && value.recovery);
  if (value.lifecycle.grantRevoked) ensure(value.lifecycle.grantMayExist && value.lifecycle.grantReference);
  ensure(Buffer.byteLength(JSON.stringify(value)) <= MAX_BYTES);
}
function statOrNull(target) { try { return fs.lstatSync(target); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } }
const identity = stat => stat && ({ dev: stat.dev, ino: stat.ino });
const sameFile = (left, right) => left?.dev === right?.dev && left?.ino === right?.ino;
function privateStat(stat, directory) {
  ensure(stat && !stat.isSymbolicLink() && (directory ? stat.isDirectory() : stat.isFile())
    && stat.uid === process.getuid() && (stat.mode & 0o7777) === (directory ? 0o700 : 0o600)
    && (directory || stat.nlink === 1), 'permissions_refused');
}
function directoryPath(directory) {
  ensure(typeof directory === 'string' && path.isAbsolute(directory) && path.resolve(directory) === directory, 'path_refused');
  const temporary = path.resolve(os.tmpdir()), relative = path.relative(temporary, directory);
  ensure(relative && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative), 'path_refused');
  const source = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
  ensure(directory !== source && !directory.startsWith(source + path.sep), 'path_refused');
  let current = path.parse(directory).root;
  for (const part of directory.slice(current.length).split(path.sep)) {
    current = path.join(current, part);
    ensure(!/^(?:\.git|library)$/i.test(part), 'path_refused');
    const stat = statOrNull(current);
    if (stat) {
      ensure(stat.isDirectory() && !stat.isSymbolicLink(), 'path_refused');
      // A private final directory cannot protect a path whose ancestor another
      // uid can rename. Root-owned sticky temporary roots are the sole writable
      // ancestor exception; their sticky bit protects our owned descendants.
      if (current !== directory) ensure((stat.uid === process.getuid() || stat.uid === 0)
        && (!(stat.mode & 0o022) || (stat.uid === 0 && (stat.mode & 0o1000))), 'path_refused');
    }
    ensure(!statOrNull(path.join(current, '.git')), 'path_refused');
  }
  return directory;
}

/** Only generated synthetic QA fixtures belong here. No ambient path/default.
 * Resume is deliberately read-only with respect to uncertain native writes:
 * publication entries retain intent, and lifecycle intents prohibit reopening. */
export function openNativeQaCheckpoint(options) {
  let directory, mode, fixture, expectedScope, state = null, lockFd = null, directoryFd = null;
  let directoryIdentity, lockIdentity, fileIdentity = null, fileDigest = null, failed = false, closed = false;
  let checkpointPath, lockPath;
  function checkDirectory() {
    directoryPath(directory); const stat = fs.lstatSync(directory); privateStat(stat, true);
    ensure(sameFile(stat, directoryIdentity), 'path_refused');
  }
  function checkFile() {
    const stat = statOrNull(checkpointPath);
    if (!fileIdentity) { ensure(!stat, 'exists'); return; }
    privateStat(stat, false); ensure(sameFile(stat, fileIdentity) && stat.size <= MAX_BYTES, 'corrupt');
    const fd = fs.openSync(checkpointPath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
      ensure(sameFile(fs.fstatSync(fd), fileIdentity), 'corrupt');
      ensure(createHash('sha256').update(fs.readFileSync(fd)).digest('hex') === fileDigest, 'corrupt');
    } finally { fs.closeSync(fd); }
  }
  function checkLock() {
    const stat = statOrNull(lockPath); privateStat(stat, false);
    const held = fs.fstatSync(lockFd); privateStat(held, false);
    ensure(sameFile(stat, lockIdentity) && sameFile(held, lockIdentity), 'writer_conflict');
  }
  function active() {
    ensure(!closed && !failed, 'closed');
    try { checkDirectory(); checkLock(); checkFile(); }
    catch { failed = true; fail('corrupt'); }
  }
  function write(next) {
    let temp = null, fd = null;
    try {
      checkDirectory(); checkLock(); checkFile();
      temp = path.join(directory, '.checkpoint-' + randomUUID() + '.tmp');
      fd = fs.openSync(temp, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
      privateStat(fs.fstatSync(fd), false);
      const content = JSON.stringify(next) + '\n'; fs.writeFileSync(fd, content); fs.fsyncSync(fd); fs.closeSync(fd); fd = null;
      checkDirectory(); checkLock(); checkFile(); fs.renameSync(temp, checkpointPath); temp = null; fs.fsyncSync(directoryFd);
      const stat = fs.lstatSync(checkpointPath); privateStat(stat, false); fileIdentity = identity(stat);
      fileDigest = createHash('sha256').update(content).digest('hex'); state = next;
    } catch {
      failed = true; fail('write_failed');
    } finally {
      if (fd !== null) { try { fs.closeSync(fd); } catch {} }
      if (temp !== null) { try { fs.unlinkSync(temp); } catch {} }
    }
  }
  function change(update) {
    active(); const next = clone(state); update(next); next.revision++;
    validateState(next); write(next);
  }
  function release() {
    let releaseFailed = false;
    if (lockFd !== null) {
      try {
        const stat = statOrNull(lockPath);
        if (stat && sameFile(stat, lockIdentity) && sameFile(fs.fstatSync(lockFd), lockIdentity)) { fs.unlinkSync(lockPath); fs.fsyncSync(directoryFd); }
      } catch { releaseFailed = true; }
      finally { try { fs.closeSync(lockFd); } catch { releaseFailed = true; } lockFd = null; }
    }
    if (directoryFd !== null) { try { fs.closeSync(directoryFd); } catch { releaseFailed = true; } directoryFd = null; }
    if (releaseFailed) fail('write_failed');
  }
  try {
    keys(options, Object.hasOwn(options || {}, 'fixture') ? ['directory', 'mode', 'fixture', 'expectedScope'] : ['directory', 'mode', 'expectedScope']);
    ({ directory, mode, fixture, expectedScope } = options);
    ensure(['new', 'resume', 'resume-unregistered', 'resume-current-owner-save'].includes(mode), 'configuration');
    validateScope(expectedScope); directoryPath(directory);
    const existingDirectory = statOrNull(directory);
    if (!existingDirectory) {
      ensure(mode === 'new', 'missing');
      // Parent directories must already exist; never create an implicit tree.
      fs.mkdirSync(directory, { mode: 0o700 });
    }
    const dirStat = fs.lstatSync(directory); privateStat(dirStat, true); directoryIdentity = identity(dirStat);
    directoryFd = fs.openSync(directory, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
    ensure(sameFile(fs.fstatSync(directoryFd), directoryIdentity), 'path_refused');
    checkpointPath = path.join(directory, FILE); lockPath = path.join(directory, LOCK);
    try { lockFd = fs.openSync(lockPath, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600); }
    catch (error) { if (error.code === 'EEXIST' || error.code === 'ELOOP') fail('writer_conflict'); throw error; }
    const lockStat = fs.fstatSync(lockFd); privateStat(lockStat, false); lockIdentity = identity(lockStat);
    fs.writeFileSync(lockFd, 'native-qa-writer/v1\n'); fs.fsyncSync(lockFd); fs.fsyncSync(directoryFd);
    const existing = statOrNull(checkpointPath);
    if (mode === 'new') {
      ensure(!existing, 'exists'); validateFixture(fixture);
      ensure(scopeKeys.every(key => fixture[key] === expectedScope[key]), 'scope_mismatch');
      const initial = { schema: SCHEMA, version: 1, revision: 1, fixture: clone(fixture), registrationIntent: false,
        credential: null, owner: null, recovery: null, publications: [],
        lifecycle: { grantMayExist: false, coachingMayExist: false, grantReference: null, grantRevoked: false } };
      validateState(initial); write(initial);
    } else {
      ensure(existing, 'missing'); privateStat(existing, false); ensure(existing.size > 0 && existing.size <= MAX_BYTES, 'corrupt');
      const fd = fs.openSync(checkpointPath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      let content;
      try { ensure(sameFile(fs.fstatSync(fd), existing), 'corrupt'); content = fs.readFileSync(fd); } finally { fs.closeSync(fd); }
      try { state = JSON.parse(content.toString('utf8')); validateState(state); } catch { fail('corrupt'); }
      ensure(scopeKeys.every(key => state.fixture[key] === expectedScope[key]), 'scope_mismatch');
      if (fixture !== undefined) { validateFixture(fixture); ensure(equal(fixture, state.fixture), 'scope_mismatch'); }
      ensure(!state.lifecycle.grantMayExist && !state.lifecycle.coachingMayExist, 'lifecycle_blocked');
      if (mode === 'resume-unregistered') {
        // This explicit lane can only reopen the original, untouched fixture.
        // Any recorded registration or later intent remains unrecoverable here.
        ensure(state.registrationIntent === false && state.credential === null && state.owner === null && state.recovery === null
          && state.publications.length === 0 && state.lifecycle.grantReference === null && state.lifecycle.grantRevoked === false, 'unrecoverable');
      } else ensure(state.registrationIntent && state.credential && state.owner && state.recovery, 'unrecoverable');
      if (mode === 'resume-current-owner-save') ensure(state.publications.length === 2
        && state.publications.some(value => value.kind === 'index') && state.publications.some(value => value.kind === 'profile'), 'unrecoverable');
      fileIdentity = identity(existing); fileDigest = createHash('sha256').update(content).digest('hex');
      checkDirectory(); checkLock(); checkFile();
    }
  } catch (error) {
    try { release(); } catch {}
    const code = nativeQaCheckpointFailureCode(error);
    fail(code ? code.slice('qa_checkpoint_'.length) : 'configuration');
  }
  const api = {
    snapshot() { active(); return clone(state); },
    recordRegistrationIntent() { active(); if (!state.registrationIntent) change(next => { next.registrationIntent = true; }); },
    recordCredential(value) {
      active(); validateCredential(value, state.fixture); ensure(state.registrationIntent);
      if (state.credential) ensure(credentialKeys.filter(key => key !== 'signCount').every(key => state.credential[key] === value[key])
        && value.signCount >= state.credential.signCount);
      if (!equal(value, state.credential)) change(next => { next.credential = clone(value); });
    },
    recordOwner(value) { active(); validateOwner(value, state.credential, state.fixture); ensure(!state.owner || equal(value, state.owner));
      if (!state.owner) change(next => { next.owner = clone(value); }); },
    recordRecovery(value) { active(); validateRecovery(value, state.owner, state.fixture); ensure(!state.recovery || equal(value, state.recovery));
      if (!state.recovery) change(next => { next.recovery = clone(value); }); },
    recordPublication(value) {
      active(); keys(value, ['kind', 'graphIri', 'operationId', 'digest']); ensure(state.recovery);
      text(value.operationId, 50);
      const normalized = { kind: value.kind, graphIri: value.graphIri, operationId: value.operationId, digest: value.digest };
      if (uuidUrn.test(normalized.operationId)) normalized.operationId = normalized.operationId.slice(9);
      validatePublication(normalized, state.owner);
      const previous = state.publications.find(entry => entry.kind === normalized.kind || entry.operationId === normalized.operationId);
      ensure(!previous || equal(previous, normalized));
      if (!previous) { ensure(mode === 'new' || mode === 'resume-unregistered'); change(next => { next.publications.push(normalized); }); }
    },
    recordLifecycle(value) {
      active(); const hasReference = Object.hasOwn(value || {}, 'reference');
      keys(value, hasReference ? ['kind', 'reference'] : ['kind']);
      ensure(state.owner && state.recovery);
      if (value.kind === 'main-world-grant-intent') {
        ensure(!hasReference && !state.lifecycle.grantRevoked);
        if (!state.lifecycle.grantMayExist) change(next => { next.lifecycle.grantMayExist = true; });
      } else if (value.kind === 'main-world-grant-reference') {
        ensure(hasReference && state.lifecycle.grantMayExist); grantReference(value.reference);
        ensure(!state.lifecycle.grantReference || equal(state.lifecycle.grantReference, value.reference));
        if (!state.lifecycle.grantReference) change(next => { next.lifecycle.grantReference = clone(value.reference); });
      } else if (value.kind === 'main-world-revoked') {
        ensure(state.lifecycle.grantMayExist && state.lifecycle.grantReference
          && (!hasReference || equal(state.lifecycle.grantReference, value.reference)));
        if (!state.lifecycle.grantRevoked) change(next => { next.lifecycle.grantRevoked = true; });
      } else if (value.kind === 'coaching-delivery-intent') {
        ensure(!hasReference);
        if (!state.lifecycle.coachingMayExist) change(next => { next.lifecycle.coachingMayExist = true; });
      } else fail('transition_refused');
    },
    close() { if (closed) return; closed = true; state = null; try { release(); } catch { fail('write_failed'); } },
  };
  // Callers receive fixed messages even for malformed input or an unexpected
  // filesystem exception. Never attach the underlying error as a cause.
  return Object.freeze(Object.fromEntries(Object.entries(api).map(([name, method]) => [name, (...args) => {
    try { return method(...args); }
    catch (error) { const code = nativeQaCheckpointFailureCode(error); fail(code ? code.slice('qa_checkpoint_'.length) : 'transition_refused'); }
  }])));
}
