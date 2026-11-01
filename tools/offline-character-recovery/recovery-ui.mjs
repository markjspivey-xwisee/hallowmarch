import { createOfflineKeyRecovery } from './recovery-core.mjs';
import { checkedPublicScope } from './scope.mjs';

const byId = id => document.getElementById(id);
const consent = byId('consent'), check = byId('check'), download = byId('download');
const passphrase = byId('passphrase'), confirmation = byId('confirm-passphrase');
const candidates = byId('candidates'), backup = byId('backup'), status = byId('status');
const urls = new Set(); let recovery, selectedHandle = null, busy = false, generation = 0;
const clearPrivate = () => { passphrase.value = ''; confirmation.value = ''; };
const clearDownloadUrls = () => { for (const url of urls) URL.revokeObjectURL(url); urls.clear(); };
const controls = () => {
  check.disabled = busy || !recovery || !consent.checked;
  passphrase.disabled = confirmation.disabled = busy;
  download.disabled = busy || !consent.checked || !selectedHandle || passphrase.value.length < 12
    || passphrase.value.length > 4096 || passphrase.value !== confirmation.value;
};
const clear = () => {
  generation++; recovery?.cancel(); busy = false; selectedHandle = null;
  candidates.replaceChildren(); backup.hidden = true; clearPrivate(); clearDownloadUrls(); controls();
};
try {
  const publicScope = checkedPublicScope(JSON.parse(byId('public-scope').content.textContent));
  byId('owner').textContent = publicScope.ownerDid; byId('pod').textContent = publicScope.podUrl;
  recovery = createOfflineKeyRecovery({ publicScope });
} catch { status.textContent = 'This optional recovery page is unavailable. Existing keys and saves have not been changed.'; }
controls();
consent.addEventListener('change', () => {
  if (!consent.checked) { clear(); status.textContent = 'Check cancelled. Existing keys and saves have not been changed.'; }
  controls();
});
for (const field of [passphrase, confirmation]) field.addEventListener('input', controls);
check.addEventListener('click', async event => {
  if (!event.isTrusted || busy || !consent.checked || !recovery) return;
  clear(); busy = true; controls(); const attempt = generation;
  status.textContent = 'Checking only the existing key slot for the identity shown above…';
  const found = await recovery.check({ consent: true });
  if (attempt !== generation || !consent.checked) return;
  busy = false;
  if (found.status === 'candidates') {
    status.textContent = 'An existing key may be available. It has not been matched to your character.';
    for (const candidate of found.candidates) {
      const label = document.createElement('label'), radio = document.createElement('input'), text = document.createElement('span');
      label.className = 'candidate';
      radio.type = 'radio'; radio.name = 'candidate'; radio.value = candidate.handle;
      text.textContent = 'Possible key: ' + candidate.publicKey + ' · ' + candidate.relayOrigin;
      label.append(radio, text); candidates.append(label);
      radio.addEventListener('change', event => {
        if (!event.isTrusted || busy || !radio.checked || !consent.checked) return;
        selectedHandle = candidate.handle; clearPrivate(); backup.hidden = false; controls();
      });
    }
  } else status.textContent = found.status === 'no_candidate'
    ? 'No existing key was found in the checked slot. Nothing was created or changed.'
    : 'This browser key could not be checked. Nothing was created or changed. You can cancel and return to the game.';
  controls();
});
download.addEventListener('click', async event => {
  if (!event.isTrusted || download.disabled || busy || !recovery) return;
  const phrase = passphrase.value, handle = selectedHandle;
  clearPrivate(); busy = true; controls(); const attempt = generation;
  status.textContent = 'Encrypting your backup on this computer…';
  const outcome = await recovery.backup({ handle, passphrase: phrase, consent: consent.checked });
  if (attempt !== generation || !consent.checked) return;
  busy = false; clearPrivate();
  if (outcome.status === 'backup_ready') {
    const blob = new Blob([JSON.stringify(outcome.recovery)], { type: 'application/json' });
    const url = URL.createObjectURL(blob), link = document.createElement('a'); urls.add(url);
    link.href = url; link.download = 'hallowmarch-encrypted-recovery.json'; link.rel = 'noreferrer';
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => { URL.revokeObjectURL(url); urls.delete(url); }, 1000);
    status.textContent = 'Encrypted recovery file downloaded. Your original key and saved character have not been changed. Use the normal production game to verify this possible key.';
  } else status.textContent = outcome.status === 'changed'
    ? 'The existing key changed during the check. No backup was downloaded. Check again before continuing.'
    : 'The backup could not be completed. Your existing key and saved character have not been changed.';
  controls();
});
byId('cancel').addEventListener('click', event => {
  if (!event.isTrusted) return;
  consent.checked = false; clear(); status.textContent = 'Cancelled. Existing keys and saves have not been changed.';
});
window.addEventListener('pagehide', () => { clear(); recovery?.close(); }, { once: true });
