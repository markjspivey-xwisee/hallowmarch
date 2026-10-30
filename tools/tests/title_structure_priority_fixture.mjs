// Exact source allowance only. Importing this helper never runs a test or evaluates game code.
import assert from 'node:assert/strict';

export const structurePriorityEdits = Object.freeze([
  Object.freeze({
    before: '  // Experimental scheduling only: measured native stragglers have large\n'
      + '  // original shaders. Reorder preparation, never draws or shader/cache inputs.\n'
      + '  // The renderer remains the authority for actual program-cache identity.',
    after: '  // Experimental initial ordering: prepare the existing structures family first.\n'
      + '  // Preserve source-size order and original-index ties within both finite partitions.\n'
      + '  // Only preparation order changes; the renderer remains the program-cache authority.',
  }),
  Object.freeze({
    before: "  ordered.sort((a, b) => b.chars - a.chars || a.index - b.index);",
    after: "  ordered.sort((a, b) => Number(b.job.family === 'structures') - Number(a.job.family === 'structures') || b.chars - a.chars || a.index - b.index);",
  }),
  Object.freeze({
    before: "queuePolicy: dependencyId === 'initial' ? 'combined-source-size' : 'staged'",
    after: "queuePolicy: dependencyId === 'initial' ? 'combined-structures-first-source-size' : 'staged'",
  }),
]);

export function undoStructureFamilyPriority(source) {
  let restored = source.replace(/\r\n/g, '\n');
  for (const { before, after } of structurePriorityEdits) {
    assert.equal(restored.split(after).length, 2, 'Exactly one approved structure-priority literal');
    restored = restored.replace(after, before);
  }
  return restored;
}
