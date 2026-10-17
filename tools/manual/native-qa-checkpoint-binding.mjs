/** Fixed owned-page checkpoint acknowledgements; no HTTP/export/evaluation port. */
export async function installNativeQaCheckpointBinding({ page, gameOrigin, checkpoint }) {
  const exact = (value, fields) => value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).length === fields.length && fields.every(key => Object.hasOwn(value, key));
  await page.exposeBinding('__hmNativeQaCheckpoint', async (source, event) => {
    try {
      if (source.page !== page || source.frame !== page.mainFrame() || new URL(source.frame.url()).origin !== gameOrigin) throw Error('scope');
      if (event?.kind === 'recovery' && exact(event, ['kind', 'recovery'])) checkpoint.recordRecovery(event.recovery);
      else if (event?.kind === 'publication' && exact(event, ['kind', 'recordKind', 'graphIri', 'operationId', 'digest'])) {
        checkpoint.recordPublication({ kind: event.recordKind, graphIri: event.graphIri, operationId: event.operationId, digest: event.digest });
      } else throw Error('shape');
      return { ok: true };
    } catch { return { ok: false, code: 'qa_checkpoint_failed' }; }
  });
}
