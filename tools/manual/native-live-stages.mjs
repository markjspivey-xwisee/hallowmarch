/** A fixed manual QA plan; failed stages retain their original closure state. */
export function nativeLiveStages(steps, onStage = () => {}) {
  if (!Array.isArray(steps) || !steps.length || steps.some(value => !/^[a-z-]+$/.test(value.name) || typeof value.run !== 'function')
    || new Set(steps.map(value => value.name)).size !== steps.length) throw new TypeError('A fixed QA stage plan is required.');
  let cursor = 0, busy = false;
  const status = () => ({ stage: steps[cursor]?.name || 'complete', completed: cursor, total: steps.length, complete: cursor === steps.length, busy });
  async function advance(all) {
    if (busy) throw Object.assign(new Error('The QA plan is busy.'), { code: 'qa_plan_busy' });
    busy = true;
    try {
      do {
        if (cursor === steps.length) break;
        onStage(steps[cursor].name);
        await steps[cursor].run(); // Failure leaves this SAME closure at its cursor.
        cursor++;
      } while (all);
      return status();
    } finally { busy = false; }
  }
  return Object.freeze({ status, next: () => advance(false), remaining: () => advance(true) });
}
