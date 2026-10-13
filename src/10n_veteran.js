/* ================================================================== */
/* [late3] a veteran the March can see                                 */
/* ================================================================== */
// (version 17) What a veteran has done shows on it, and on its standard:
//  - the mantle of your name: from level 40, while you wear a name, a mantle in your realm's colours hangs from your
//    shoulders with the device of the name's deed on its back and a gilt border down its edges and hem (04_l3device.js;
//    drawn by the people's shader as the cape is, so it takes the rain, the mud, the blood and the tears as the rest of
//    your gear does: 05a_rig.js). The Deeds page puts it away and takes it out again;
//  - the standard of your name carries the device on its flag in place of the realm's arms, with a gilt border
//    (`late3StdCode`, read by late2StdShow, 10l_late.js);
//  - foes strike the standard down: every foe fighting within reach of it hews at it, champions and lords hardest, and when
//    its might is spent it falls (the pole topples, the flag lies furled on the ground and the March fights no harder
//    about it) until you raise it again (Use beside it).
// Saved with the character (save part `char.x.vet3`: the mantle put away, the standard fallen).

const L3V = { mantle: true, std: { hp: 1, fallen: false, k: 0, side: 1, code: -1, shake: 0 }, stats: { hits: 0, fell: 0, raised: 0 } };
const L3V_STD = { lv: 40, reach: 2.8, hit: 0.07, champ: 0.18, lord: 0.13, fallT: 0.8, raiseT: 0.9 };
// the barding of your horse: from this rank of veterancy the horse you ride (and your own, standing) wears the device of
// the name you wear on each flank of its cloth, in gold with a gilt band (a peak, veterancy's own, with no name worn)
const L3V_BARD = 3;
// the device of the name you wear (L3_DEVICE_OF, 04_l3device.js), or -1
function late3Device() { const N = late2Worn(); return N && L3_DEVICE_OF[N.deed] != null ? L3_DEVICE_OF[N.deed] : -1; }
const late3MantleOk = () => !!GAME.prog && GAME.prog.level >= L3V_STD.lv && late3Device() >= 0;
// the people's shader: the device above the realm's emblem (8 x (device + 1)), and the cape's bit (drawActors, 13_main.js)
function late3MantleCode(e) { return L3V.mantle && e.alive && late3MantleOk() ? 8 * (late3Device() + 1) : 0; }
// the banners' shader: the realm + 4 x (device + 1) on the standard's flag (late2StdShow, 10l_late.js)
function late3StdCode() { const d = late3Device(); return d >= 0 ? 4 * (d + 1) : 0; }
const late3StdDown = () => !!LATE2.std.at && L3V.std.fallen;
// the beasts' shader: 4 x (device + 1) above the cloth's red (drawActors, 13_main.js; the cloth's branch in 05c_beasts.js)
function late3BardCode(P) { if (!P || P !== GAME.player || !(LATE2.vet >= L3V_BARD)) return 0; const d = late3Device(); return 4 * ((d >= 0 ? d : 8) + 1); }

/* ------------------------------------------------------------------ */
/* the standard struck down, and raised again                          */
/* ------------------------------------------------------------------ */
let L3V_HEAP = null; // the flag lying furled on the ground by the fallen pole: made the first time it falls
function late3StdHeap() {
  if (L3V_HEAP) return L3V_HEAP;
  const b = new Batch(), M0 = new THREE.Matrix4(), rnd = mulberry(5521);
  for (let q = 0; q < 5; q++) b.add(G.box, lm(M0, 0.1 + q * 0.2 + (rnd() - 0.5) * 0.05, 0.05 + (q % 2) * 0.03, (rnd() - 0.5) * 0.12, (rnd() - 0.5) * 0.6, 0.32, 0.09, 0.42 - q * 0.04, (rnd() - 0.5) * 0.3), MAT.cloth, [0.6, 0.6, 0.6]);
  L3V_HEAP = new THREE.Mesh(b.build(), buildingMat);
  L3V_HEAP.visible = false;
  L3V_HEAP.matrixAutoUpdate = true;
  scene.add(L3V_HEAP);
  return L3V_HEAP;
}
// the pole's pose and the flag: upright, falling, fallen, rising (once a step while it moves; late2StdShow asks too)
function late3StdPose() {
  if (!L2STD.mesh) return;
  const at = LATE2.std.at, S = L3V.std, m = L2STD.mesh, B = bannerGeo.attributes;
  const k = at ? smooth(clamp(S.k, 0, 1)) : 0;
  m.rotation.set(0, 0, S.side * k * 1.5);
  m.updateMatrixWorld();
  if (at) {
    const code = (GAME.player ? GAME.player.faction : 0) + late3StdCode();
    const y = heightAt(at.x, at.z) - 0.08;
    if (k > 0.02) B.aB0.array.set([0, -999, 0, 0], L2STD.slot * 4); // the flag comes down with the pole
    else B.aB0.array.set([at.x, y + LATE2_STD.flagTop, at.z, 0], L2STD.slot * 4); // [late4] the flag's hoist down the pole's head (10l_late.js)
    B.aB1.array[L2STD.slot * 4 + 2] = code;
    B.aB1.array[L2STD.slot * 4 + 3] = late4StdKind(); // [late4] a veteran's flag, torn as it is struck (10o_late4.js)
    S.code = code;
    B.aB0.needsUpdate = true; B.aB1.needsUpdate = true;
    const H = S.fallen || k > 0.5 ? late3StdHeap() : L3V_HEAP;
    if (H) {
      H.visible = k > 0.95;
      if (H.visible) {
        const R = REALMS[GAME.player ? GAME.player.faction : 0], len = LATE2_STD.poleH * 0.92;
        H.position.set(at.x - S.side * len, heightAt(at.x - S.side * len, at.z) + 0.02, at.z);
        if (H.userData.realm !== R.id) { // the cloth in the realm's colour (its vertex colours, once a realm)
          const c = H.geometry.attributes.aCol;
          if (c && c.array) { for (let i = 0; i < c.count; i++) c.setXYZ(i, R.rgb[0] * 0.75, R.rgb[1] * 0.75, R.rgb[2] * 0.75); c.needsUpdate = true; H.userData.realm = R.id; }
        }
      }
    }
  } else if (L3V_HEAP) L3V_HEAP.visible = false;
}
function late3StdFall(by) {
  const S = L3V.std, at = LATE2.std.at, P = GAME.player;
  if (S.fallen || !at) return;
  S.fallen = true; S.hp = 0;
  S.side = Math.random() < 0.5 ? -1 : 1;
  L3V.stats.fell++;
  sfxAt('thud', at.x, heightAt(at.x, at.z) + 0.5, at.z); sfxAt('hit', at.x, heightAt(at.x, at.z) + 2.5, at.z);
  FX.dust(at.x - S.side * 1.8, heightAt(at.x, at.z), at.z, 14);
  if (P) {
    const near = dist(P.x, P.z, at.x, at.z) < 80;
    uiLog(`${by ? capFirst(by.name) + ' strikes down' : 'Your foes strike down'} the standard of ${late2Named(P)}!${near ? ` ${IS_TOUCH ? 'Use' : 'E'} beside it raises it again.` : ''}`, 'hurt');
    if (near) uiBanner(`The standard of ${late2Named(P)} has fallen!`, P.faction);
  }
  if (typeof loreNote === 'function') loreNote('l3stdfall');
  saveSoon();
}
function late3StdRaise() {
  const S = L3V.std, P = GAME.player, at = LATE2.std.at;
  if (!S.fallen || !at || !P || !P.alive) return false;
  S.fallen = false; S.hp = 1;
  L3V.stats.raised++;
  setAct(P, 5, 0.9);
  sfxAt('thud', at.x, heightAt(at.x, at.z) + 0.2, at.z);
  uiLog(`You raise the standard of ${late2Named(P)} again.`, 'level');
  saveSoon();
  return true;
}
// once a second (late2StdStep, 10l_late.js): foes fighting within reach of it hew at it
function late3StdStep() {
  const at = LATE2.std.at, P = GAME.player, S = L3V.std;
  if (!at || !P) { if (S.fallen || S.hp < 1) { S.fallen = false; S.hp = 1; S.k = 0; } return; }
  if (S.code !== P.faction + late3StdCode()) late3StdPose(); // (the name worn changed: the device with it)
  if (S.fallen) return;
  let dmg = 0, by = null;
  forNear(at.x, at.z, L3V_STD.reach, (o) => {
    if (!o.alive || o.kind === 'door' || !isActor(o) || o.role === 'villager' || o.role === 'critter' || o.role === 'animal' || !isEnemy(o, P) || GAME.t > (o.combatUntil || 0) + 1) return;
    const h = o.l2risen || o.elite || o.role === 'boss' ? L3V_STD.champ : o.role === 'lord' || o.role === 'guardian' ? L3V_STD.lord : L3V_STD.hit;
    if (h > dmg) by = o;
    dmg += h;
  });
  if (!dmg) { S.hp = Math.min(1, S.hp + 0.02); return; } // (a lull: the bearers steady it)
  S.hp -= dmg;
  late4StdTear(dmg); // [late4] the cloth rent by what strikes it (10o_late4.js)
  L3V.stats.hits++;
  S.shake = 0.4;
  const y = heightAt(at.x, at.z);
  FX.sparks(at.x, y + 1.2, at.z);
  sfxAt('hit', at.x, y + 1.2, at.z);
  if (by && by.kind === 'humanoid' && !by.casting) { faceToward(by, at.x, at.z); setAct(by, by.mobType === 'troll' ? 8 : 1, 0.5); }
  if (S.hp <= 0) late3StdFall(by);
}
// each step: the pole falling or rising, shaking where it is struck
function late3VetStep(dt) {
  const S = L3V.std;
  if (!LATE2.std.at) return;
  const want = S.fallen ? 1 : 0;
  if (S.k !== want) { S.k = clamp(S.k + Math.sign(want - S.k) * dt / (S.fallen ? L3V_STD.fallT : L3V_STD.raiseT), 0, 1); late3StdPose(); }
  if (S.shake > 0 && L2STD.mesh) {
    S.shake = Math.max(0, S.shake - dt);
    if (!S.fallen) { L2STD.mesh.rotation.x = Math.sin(GAME.t * 40) * 0.035 * S.shake; L2STD.mesh.updateMatrixWorld(); }
  }
}
// Use beside a fallen standard (late2Offers, 10l_late.js)
function late3StdOffers(P, offer) {
  const at = LATE2.std.at;
  if (at && L3V.std.fallen && !inDungeon(P)) offer(dist(P.x, P.z, at.x, at.z) - 0.3, 3.0, 'Raise your standard', () => late3StdRaise(), 0.3);
}

/* ------------------------------------------------------------------ */
/* the Chronicle's Deeds page, the notes, the save                     */
/* ------------------------------------------------------------------ */
function late3MantleHTML() {
  const P = GAME.player, R = REALMS[P.faction], d = late3Device();
  if (!LATE2.worn) return '';
  const dev = d >= 0 ? L3_DEVICE_NAMES[d] : 'none';
  if (GAME.prog.level < L3V_STD.lv) return `<p>From level ${L3V_STD.lv} you wear the mantle of your name: ${esc(R.name)}'s colours with its device (${esc(dev)}) on the back.</p>`;
  return `<p>You wear the mantle of your name: ${esc(R.name)}'s colours, ${esc(dev)} on its back for the deed you are named for, a gilt border down its edges. It takes the rain, the mud and the blows as the rest of your gear does.</p>${late3BardHTML()}<div class="acts"><button type="button" class="btn l2-btn" data-l3="mantle">${L3V.mantle ? 'Put the mantle away' : 'Wear the mantle'}</button></div>`;
}
function late3BardHTML() {
  const d = late3Device(), dev = L3_DEVICE_NAMES[d >= 0 ? d : 8];
  if (!(GAME.prog.level >= LEVEL_CAP)) return '';
  if (LATE2.vet < L3V_BARD) return `<p>At veterancy ${L3V_BARD} your horse earns its barding: the device of your name on each flank of its cloth, in gold.</p>`;
  return `<p>Your horse wears its barding: ${esc(dev)} in gold on each flank of its cloth${d >= 0 ? ', the device of the name you wear' : ' (veterancy\'s own, until you wear a name)'}.</p>`;
}
function late3StdHTML() {
  if (!LATE2.std.made) return '';
  const d = late3Device(), dev = d >= 0 ? L3_DEVICE_NAMES[d] : null;
  return `<p>Its flag carries ${dev ? `the device of the name you wear (${esc(dev)}) on your realm's colours, in a gilt border` : 'your realm\'s arms until you wear a name, then its device'}. Foes fighting about it hew at it, champions and lords hardest: struck down, it falls and the March fights no harder about it until you raise it again (${IS_TOUCH ? 'Use' : 'E'} beside it).${late3StdDown() ? ' <b>It lies fallen.</b>' : ''}</p>`;
}
$('menu-body').addEventListener('click', (ev) => {
  const b = ev.target.closest('.chron [data-l3]');
  if (!b || b.disabled) return;
  if (b.dataset.l3 === 'mantle') { L3V.mantle = !L3V.mantle; saveSoon(); sfx('click'); renderChronicle($('menu-body'), true); }
});
if (!FIELD_NOTES.l3mantle) FIELD_NOTES.l3mantle = { t: 'The mantle of your name', x: () => `From level ${L3V_STD.lv} the name you wear shows on your shoulders: a mantle in your realm's colours with the device of its deed on the back. The Chronicle's Deeds page puts it away.` };
if (!FIELD_NOTES.l3stdfall) FIELD_NOTES.l3stdfall = { t: 'A standard struck down', x: () => `Foes fighting about your standard hew at it. Struck down, it gives no strength until you raise it again: ${IS_TOUCH ? 'tap Use' : 'press E'} beside it.` };
if (!FIELD_NOTES.l3bard) FIELD_NOTES.l3bard = { t: 'Your horse\'s barding', x: () => `Veterancy ${L3V_BARD}: the horse you ride wears your barding now, the device of your name in gold on each flank of its cloth.` };
GUIDE_WATCH.l3mantle = () => late3MantleOk() && L3V.mantle;
GUIDE_WATCH.l3bard = (P) => !!P.mount && LATE2.vet >= L3V_BARD;
LOADING_TIPS.push('From level 40 the name you wear shows on your mantle, and its device on the flag of your standard. At veterancy 3 your horse wears it too.', 'Foes fighting about your standard can strike it down. Raise it again with Use beside it.');
registerSavePart('char', 'vet3', {
  save: () => (!L3V.mantle || L3V.std.fallen ? { m: L3V.mantle ? 1 : 0, f: L3V.std.fallen ? 1 : 0 } : null),
  load(o) {
    o = o && typeof o === 'object' && !Array.isArray(o) ? o : null;
    L3V.mantle = !o || o.m !== 0;
    L3V.std = { hp: 1, fallen: !!(o && o.f), k: o && o.f ? 1 : 0, side: 1, code: -1, shake: 0 };
    try { late3StdPose(); } catch (e) { reportError(e); }
  },
  key: (o) => (o ? [o.m, o.f] : null),
});
queueMicrotask(() => { if (window.__hm) window.__hm.vet3 = { L3V, L3V_STD, L3V_BARD, late3BardCode, late3BardHTML, late3Device, late3MantleCode, late3StdCode, late3StdStep, late3StdFall, late3StdRaise, late3StdPose, late3StdOffers, late3MantleHTML, late3StdHTML, late3MantleOk }; });
