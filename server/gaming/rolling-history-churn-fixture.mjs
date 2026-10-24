// Deterministic codec pressure fixture: authored entity rows with ordinary
// retirement, respawn, optional fields and changing collection lengths.
import { createHash } from 'node:crypto';
import { realisticRollingWindow } from './rolling-history-scale-fixture.mjs';
const copy = value => JSON.parse(JSON.stringify(value));
const canonical = value => value === null || typeof value !== 'object' ? JSON.stringify(value) : Array.isArray(value)
  ? '[' + value.map(canonical).join(',') + ']' : '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
const round = value => Math.round(value * 100) / 100;
export function realisticChurningRollingWindow(options = {}) {
  const doc = copy(realisticRollingWindow(options));
  for (let minute = 0; minute < doc.checkpoints.length; minute++) {
    const checkpoint = doc.checkpoints[minute], world = checkpoint.streams[0], activity = world.state.value.worlds.march.activity;
    const rows = activity.entities.rows, removed = rows.splice(Math.floor(rows.length * 0.4) + minute % 11, 1 + minute % 3);
    for (let i = 0; i < removed.length; i++) {
      const spawned = copy(removed[i]);
      spawned.id = 'scene:churn:' + (minute * 3 + i);
      spawned.key = 'fixture:respawn:' + (minute * 3 + i);
      spawned.name = 'Respawn ' + minute + ':' + i;
      spawned.p = [round(spawned.p[0] + 2.37), spawned.p[1], round(spawned.p[2] - 1.83)];
      rows.push(spawned);
    }
    if (minute % 10 === 0) rows.push(rows.shift());
    for (let i = 0; i < rows.length; i++) {
      if ((i + minute) % 7 === 0) delete rows[i].hp;
      else rows[i].hp = Math.max(0, rows[i].maxHp - (i + minute) % 17);
      if ((i + minute) % 43 === 0) rows[i].buffs = Array.from({ length: 1 + minute % 2 }, (_, j) => ({ kind: 'slow', value: 0.35, left: 2.3 + j }));
      else delete rows[i].buffs;
      if ((i + minute) % 59 === 0) rows[i].alive = 0;
      else delete rows[i].alive;
    }
    const parts = activity.worldparts.parts;
    const plots = parts.farm.plots;
    for (let i = 0; i < plots.length; i++) {
      plots[i].growth = Math.round(((minute + i) % 61) / 60 * 1000) / 1000;
      if ((minute + i) % 3 === 0) plots[i].crop = 'grain';
      else delete plots[i].crop;
    }
    if (minute % 3) plots.push({ id: 1000 + minute, growth: 0 });
    const pieces = parts.build.pieces;
    if (minute % 2) pieces.splice(7, 1);
    pieces.push({ id: 2000 + minute, t: 'found', x: minute % 12 * 3, z: 63, y: 0, yaw: 0, st: 'built', p: 1, char: 0 });
    const minerals = parts.resources.mineral;
    minerals.splice(17 + minute % 4, 1);
    minerals.push({ id: 3000 + minute, x: minute * 2, z: 86, kind: 'iron', left: 100 - minute % 20 });
    if (minute % 2) minerals.push({ id: 4000 + minute, x: minute * 2, z: 91, kind: 'stone', left: 30 });
    for (let i = 0; i < activity.boats.length; i++) activity.boats[i].rider = (minute + i) % 5 ? null : 'fixture-rider-' + i;
    activity.worldparts.receipts = Array.from({ length: minute % 4 }, (_, i) => ({
      id: 'fixture-receipt-' + minute + '-' + i, delta: { stone: 1 + i }, settled: true }));
    world.state.digest = 'sha256:' + createHash('sha256').update(canonical(world.state.value)).digest('hex');
  }
  const finalWorld = doc.checkpoints.at(-1).streams[0];
  doc.streams = doc.streams.map(row => row.streamId === finalWorld.streamId ? copy(finalWorld) : row);
  return doc;
}
