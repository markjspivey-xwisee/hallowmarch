/** One manual stdin reader. Public signing replies remain routable while a
 * fixed command awaits a native operation; input is never evaluated or echoed. */
import { createInterface } from 'node:readline';

const commands = new Set(['status', 'diagnose', 'retry', 'continue', 'companion-restart-admission']);
export function createNativeLiveInput({ input, acceptProtocolLine = () => false, onCommand,
  onClose = () => {}, onInvalid = () => {}, onBusy = () => {}, onError = () => {} } = {}) {
  if (!input || typeof onCommand !== 'function') throw new TypeError('Manual input ports are required.');
  let running = false, diagnosticRunning = false, closed = false, resolveClosed;
  const finished = new Promise(resolve => { resolveClosed = resolve; });
  const reader = createInterface({ input, terminal: false });
  const safe = callback => { try { callback(); } catch { /* No raw callback errors leave this router. */ } };
  reader.on('line', line => {
    if (closed) return;
    // This must precede command concurrency checks. A command can itself be
    // waiting for the signed response that arrives through this same reader.
    try { if (acceptProtocolLine(line) === true) return; }
    catch { safe(onError); return; }
    if (typeof line !== 'string' || Buffer.byteLength(line) > 32768) { safe(onInvalid); return; }
    const action = line.trim();
    if (action === 'finish') { reader.close(); return; }
    if (!commands.has(action)) { safe(onInvalid); return; }
    const diagnostic = action === 'status' || action === 'diagnose';
    if (diagnostic ? diagnosticRunning : running) { safe(onBusy); return; }
    if (diagnostic) diagnosticRunning = true; else running = true;
    Promise.resolve().then(() => onCommand(action)).catch(() => safe(onError)).finally(() => {
      if (diagnostic) diagnosticRunning = false; else running = false;
    });
  });
  reader.once('close', () => {
    closed = true;
    Promise.resolve().then(onClose).catch(() => safe(onError)).finally(resolveClosed);
  });
  return Object.freeze({ status: () => ({ kind: 'native_qa_input', closed, commandBusy: running, diagnosticBusy: diagnosticRunning }),
    waitForClose: () => finished, close: () => reader.close() });
}
