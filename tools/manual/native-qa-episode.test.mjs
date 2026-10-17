import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNativeQaEpisode, validateNativeQaEpisodeFile } from './native-qa-episode.mjs';

const scope = { run: 'synthetic-episode', gameOrigin: 'https://game.example', relayOrigin: 'https://relay.example' };
test('episode file is explicit, exclusive and refuses prior intent before any live I/O', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'hm-episode-'));
  try {
    for (const value of [undefined, 'relative.json', '/tmp/x\nprivate']) assert.throws(() => validateNativeQaEpisodeFile(value), { code: 'qa_episode_configuration' });
    const file = join(directory, 'episode.jsonl');
    await writeFile(file, JSON.stringify({ kind: 'coaching-delivery-intent' }));
    await assert.rejects(createNativeQaEpisode({ ...scope, file }), { code: 'qa_episode_exists_or_unreadable' });
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { kind: 'coaching-delivery-intent' });
    const unreadable = join(directory, 'unreadable'); await mkdir(unreadable);
    await assert.rejects(createNativeQaEpisode({ ...scope, file: unreadable }), { code: 'qa_episode_exists_or_unreadable' });
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test('main-world completion cannot clear, replace or replay the independent coaching intent', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'hm-episode-')), file = join(directory, 'episode.jsonl');
  let ledger;
  try {
    ledger = await createNativeQaEpisode({ ...scope, file });
    await assert.rejects(ledger.mark('coaching-delivery-intent'), { code: 'qa_episode_stage_refused' });
    await ledger.mark('main-world-complete'); await ledger.mark('coaching-delivery-intent');
    await assert.rejects(ledger.mark('main-world-complete'), { code: 'qa_episode_stage_refused' });
    await assert.rejects(ledger.mark('coaching-delivery-intent'), { code: 'qa_episode_stage_refused' });
    await ledger.mark('coaching-followup-intent'); await ledger.mark('coaching-complete'); await ledger.close();
    await assert.rejects(ledger.mark('coaching-followup-intent'), { code: 'qa_episode_stage_refused' });
    const lines = (await readFile(file, 'utf8')).trim().split('\n').map(JSON.parse);
    assert.deepEqual(lines.map(item => item.kind), ['fixture-reserved', 'main-world-complete', 'coaching-delivery-intent', 'coaching-followup-intent', 'coaching-complete']);
    assert(lines.every(item => Object.keys(item).every(key => ['schema', 'run', 'gameOrigin', 'relayOrigin', 'kind', 'at'].includes(key))));
    assert.equal(JSON.stringify(lines).includes('subjectDid'), false);
    await assert.rejects(createNativeQaEpisode({ ...scope, file }), { code: 'qa_episode_exists_or_unreadable' });
  } finally { await ledger?.close(); await rm(directory, { recursive: true, force: true }); }
});

test('personal activity has independent ordered durable fences after coaching and cannot replay completed intent', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'hm-episode-')), file = join(directory, 'episode.jsonl'); let ledger;
  try {
    ledger = await createNativeQaEpisode({ ...scope, file });
    await ledger.mark('main-world-complete');
    await assert.rejects(ledger.mark('activity-delivery-intent'), { code: 'qa_episode_stage_refused' });
    await ledger.mark('coaching-delivery-intent'); await ledger.mark('coaching-complete');
    await assert.rejects(ledger.mark('activity-input-intent'), { code: 'qa_episode_stage_refused' });
    await ledger.mark('activity-delivery-intent');
    await assert.rejects(ledger.mark('activity-delivery-intent'), { code: 'qa_episode_stage_refused' });
    await assert.rejects(ledger.mark('activity-complete'), { code: 'qa_episode_stage_refused' });
    await ledger.mark('activity-input-intent'); await ledger.mark('activity-complete');
    await assert.rejects(ledger.mark('activity-input-intent'), { code: 'qa_episode_stage_refused' });
    await ledger.close();
    const lines = (await readFile(file, 'utf8')).trim().split('\n').map(JSON.parse);
    assert.deepEqual(lines.slice(-3).map(row => row.kind), ['activity-delivery-intent', 'activity-input-intent', 'activity-complete']);
    await assert.rejects(createNativeQaEpisode({ ...scope, file }), { code: 'qa_episode_exists_or_unreadable' });
  } finally { await ledger?.close(); await rm(directory, { recursive: true, force: true }); }
});
