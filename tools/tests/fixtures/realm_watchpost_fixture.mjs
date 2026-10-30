/** Actual-source canonical and projection fixtures; no browser, sockets or private saves. */
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { parse } from 'acorn';

export const plain = value => JSON.parse(JSON.stringify(value));
export const read = path => readFileSync(new URL('../../../' + path, import.meta.url), 'utf8');
export function selected(path, names) {
  const source = read(path), ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
  return names.map(name => {
    const node = ast.body.find(row => row.type === 'FunctionDeclaration' && row.id.name === name
      || row.type === 'VariableDeclaration' && row.declarations.some(d => d.id.type === 'Identifier' && d.id.name === name));
    assert.ok(node, path + ':' + name);
    return source.slice(node.start, node.end);
  }).join('\n');
}
export function fixture(seed = 20261030) {
  const context = vm.createContext({ module: { exports: {} } });
  vm.runInContext(read('src/08m_realm.js') + '\n' + read('src/08p_realm_management.js') + `
    globalThis.api = { RSM, RSM_GOODS, RM_CATALOG, realmSimInit, realmSimLive, realmSimSummary,
      realmSimSanitize, rsmSiege, realmManageInit, realmManageStep, realmManageAction,
      realmManageView, realmManageSanitize, realmManageDefenseSupport, realmManageBuildSiteAllowed, rmBuilding };
  `, context);
  const api = context.api, state = api.realmSimInit(seed, { days: 28 }); api.realmManageInit(state);
  const f = { api, state,
    view: realm => api.realmManageView(state, realm),
    action: (realm, args) => api.realmManageAction(state, realm, { expectedRevision: state.management.revision, ...args }),
    tick(seconds) {
      let left = seconds;
      while (left > 1e-8) { const dt = Math.min(60, left); state.t += dt; api.realmManageStep(state, dt); left -= dt; }
    },
  };
  return f;
}
export function succeed(result) { assert.equal(result.ok, true, result.why || result.message); return result; }
export function setStock(f, realm, id, n) {
  const index = f.api.RSM_GOODS.indexOf(id);
  if (index >= 0) f.state.realms[realm].s[index] = n;
  else f.state.realms[realm].management.stock[id] = n;
}
export const stocks = (f, realm = 0) => Object.fromEntries(f.view(realm).stocks.map(row => [row.id, row.n]));
export const building = (f, plotId = 'keep:0:0') => f.state.realms.flatMap(r => r.management.buildings).find(b => b.plotId === plotId);
export function fund(f, realm = 0) {
  for (const row of f.view(realm).stocks) setStock(f, realm, row.id, row.cap * 0.75);
}
export function pauseOthers(f) {
  for (let r = 0; r < 3; r++) for (const b of f.state.realms[r].management.buildings)
    succeed(f.action(r, { type: 'pause', buildingId: b.id, paused: true }));
}
export function commission(f, plotId = 'keep:0:0', realm = 0) {
  succeed(f.action(realm, { type: 'build', kind: 'watchpost', plotId }));
  succeed(f.action(realm, { type: 'workforce', buildingId: 'b:' + plotId, workers: 2, priority: 2 }));
  return building(f, plotId);
}
export function activePost() {
  const f = fixture(); fund(f); pauseOthers(f); const post = commission(f);
  f.tick(90); assert.equal(post.status, 'built'); assert.equal(post.working, false, 'completion has not paid an operating step');
  f.tick(60); assert.equal(f.api.realmManageDefenseSupport(f.state, 0), 0.1);
  return { f, post };
}
export function noChange(f, realm, args) {
  const before = plain(f.state), result = f.action(realm, args);
  assert.equal(result.ok, false); assert.deepEqual(plain(f.state), before, result.why); return result;
}

/** Actual bounded wire decoder followed by actual hosted projection and combat multiplier. */
export function clientProjection(packet, state) {
  const saveParts = [];
  const ctx = vm.createContext({
    NETWS: { url: 'https://fictional.invalid', state: 'on' }, NETS: { s: null },
    SEASONP: { rs: state }, GAME: { started: true, t: 100, prog: null },
    netCurrentWorldAdmission: () => ({ origin: 'https://fictional.invalid', epoch: 1 }),
    registerSavePart: (kind, id, adapter) => saveParts.push({ kind, id, adapter }),
    // These unrelated combat modifiers are neutral fixture boundaries; computeDamage and the watchpost hook are actual source.
    baseDmg: () => 100, buffSum: () => 0,
    Math: Object.assign(Object.create(Math), { random: () => 0.5 }),
  });
  const code = [
    selected('src/00_util.js', ['clamp']),
    selected('src/14n_net.js', ['NET_REALM_OK', 'netNum', 'netStr']),
    selected('src/14q_netseason.js', ['NETS_PHASE', 'netsRead', 'netsGoods', 'netRealmDevelopmentRead', 'netRealmManagementRead', 'netRealmLogisticsRead']),
    selected('src/08n_season.js', ['seasonServer', 'seasonKeepDefenseSupport']),
    read('src/08r_public_works.js'),
    selected('src/07_entities.js', ['REALM_BONUS', 'computeDamage']),
    `globalThis.api = { read: netsRead, apply: realmPublicWorksApply, current: realmPublicWorksCurrent,
      attack: realmPublicWorksAttackK, armor: realmPublicWorksArmorK, damage: computeDamage,
      localSupport: seasonKeepDefenseSupport };`,
  ].join('\n');
  // Pass actual canonical helper, not a replacement readiness predicate.
  const realmContext = vm.createContext({ module: { exports: {} } });
  vm.runInContext(read('src/08m_realm.js') + '\n' + read('src/08p_realm_management.js') + '\nglobalThis.support = realmManageDefenseSupport;', realmContext);
  ctx.realmManageDefenseSupport = realmContext.support;
  vm.runInContext(code, ctx);
  assert.equal(saveParts.length, 1); assert.equal(saveParts[0].kind, 'world'); assert.equal(saveParts[0].id, 'publicworks');
  const wire = ctx.api.read(plain(packet)); ctx.NETS.s = wire;
  assert.equal(ctx.api.apply(wire), true);
  return { ctx, api: ctx.api, wire,
    apply(next) { const value = ctx.api.read(plain(next)); ctx.NETS.s = value; assert.equal(ctx.api.apply(value), true); return value; },
  };
}
