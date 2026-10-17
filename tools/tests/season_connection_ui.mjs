import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function fixture() {
  const NETWS = { url: 'wss://game.example/ws', state: 'off', link: null, closed: false, reload: false, season: null };
  const context = vm.createContext({ NETWS, GAME: { player: {} }, FIELD_NOTES: {}, GUIDE_HELP: [], LOADING_TIPS: [],
    window: { __hm: {} }, $: () => ({ addEventListener() {} }), queueMicrotask() {},
    esc: value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;') });
  vm.runInContext(readFileSync(new URL('../../src/14q_netseason.js', import.meta.url), 'utf8')
    + '\nglobalThis.fixture={hud:netSeasonHudHTML,chron:netsChronSeason};', context);
  return { NETWS, ...context.fixture };
}

test('configured server failures and reconnects do not claim the player chose solo play', () => {
  const f = fixture();
  assert.match(f.hud(), /cannot be reached/); assert.match(f.chron(), /updates are unavailable/);
  assert.doesNotMatch(f.hud() + f.chron(), /playing alone/i);
  f.NETWS.state = 'opening';
  assert.match(f.hud(), /Connecting/); assert.match(f.chron(), /Connecting/);
  f.NETWS.state = 'off'; f.NETWS.link = {};
  assert.match(f.hud(), /Reconnecting/); assert.match(f.chron(), /Reconnecting/);
  assert.match(f.hud(), /role="status"/);
});

test('a server-advertised season awaiting its first update is distinct from no season', () => {
  const f = fixture(); f.NETWS.state = 'on'; f.NETWS.season = { file: 'season' };
  assert.match(f.chron(), /Waiting for.*latest season update/); assert.doesNotMatch(f.chron(), /keeps no season/);
  f.NETWS.season = null; assert.match(f.chron(), /This server keeps no season/);
  f.NETWS.url = ''; assert.match(f.chron(), /playing alone/); assert.equal(f.hud(), '');
});

test('world recovery status takes priority and is escaped in both player surfaces', () => {
  const f = fixture(); f.NETWS.worldPauseReason = 'Recovery <pending>';
  assert.match(f.hud(), /Recovery &lt;pending&gt;/); assert.match(f.chron(), /Recovery &lt;pending&gt;/);
  assert.doesNotMatch(f.hud() + f.chron(), /<pending>/);
});
