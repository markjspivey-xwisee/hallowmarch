# Optional offline character-key recovery

This is a developer-assisted recovery page for one documented old Hallowmarch address: **http://127.0.0.1:8787**. It can help the owner make an encrypted backup of an existing browser key. Finding a key does **not** establish that it opens the saved character. Missing keys cannot be reconstructed from a sign-in credential or a new Interego PC key.

The hosted game, account sign-in and browser keyfinder continue to work normally. This tool requires neither federation nor a public bridge. It adds no hosted routes, service credentials, account grants or game-save writes.

## Before using it

Use this only after reviewing the checked tool and confirming that this exact old address was previously used. A developer supplies the **public** identity DID and exact HTTPS pod root already shown by the existing account; they are not discovered from browser storage. Only the reviewed relay `https://relay.interego.xwisee.com` is checked. There is no alternate-address scan.

The owner must choose the same browser profile that previously used that local address. Other browsers, profiles, ports and hosted sites have separate key storage. This page cannot inspect them.

From the checked repository, a developer starts:

```text
node tools/offline-character-recovery/server.mjs --owner-did PUBLIC_EXISTING_DID --pod-url https://PUBLIC_POD_HOST/EXISTING_POD_NAME/
```

Both launch values are required and validated. The server binds only IPv4 loopback `127.0.0.1:8787`, refuses an occupied port, and never opens a browser. Do not change the port, proxy the page to a hosted address, or use service credentials. If another local app uses that address, stop here and review it; do not replace it automatically.

## Owner steps

1. Open **http://127.0.0.1:8787** in the original browser profile. Review **Identity being checked**. No browser storage is checked on page load.
2. If the displayed identity is correct, tick the consent box and choose **Check for an existing key**. This reads only the finite exact owner/pod/relay slot in the known key database. It never creates or changes a key or database.
3. If a possible key appears, select it. A public fingerprint alone is not character verification. Enter a **new recovery passphrase**, repeat it, and choose **Download encrypted recovery file**. Keep the passphrase private and separate from the downloaded file. This owner action rechecks that the existing key is unchanged and uses the game's existing SDK backup format and original scope.
4. Return to the normal production game, sign into the existing account, and choose **Restore recovery file**. The game must verify the uploaded key against the current authenticated owner, index and encrypted profile. Only after the expected character is shown should the owner choose **Use this key on this site**. Do not create a replacement character to test a candidate.
5. Close the page and stop the temporary server with Ctrl+C. **Cancel and clear this page** clears pending UI work and private input fields; it does not erase existing browser data.

If no key is found, a key is corrupt, or the key changes during the check, no backup is downloaded. The original key and saved character remain unchanged. A valid key backup may still fail the production character proof; retain it privately and review the result without replacing the current key.

## Privacy and limits

The static server serves only fixed files and public launch information. There are no POST endpoints, account login, analytics, request logs, storage uploads or network connections from the page. Its policy blocks connections, frames, forms, inline scripts and external assets. Protected key records and decrypted key material stay inside the browser and the existing SDK; neither is displayed or sent to the server. The recovery file is encrypted using the unchanged SDK (`interego-client-key`, version 1, PBKDF2-SHA256/AES-GCM).

The storage adapter uses only `readonly` transactions. It checks for the known database before opening; a missing-database race aborts its upgrade. Missing records are skipped before constructing a vault. Its SDK `create` method always refuses. There are no aliases, key migrations or save changes in this tool. Private passphrase inputs are cleared after submission/cancellation; JavaScript cannot promise to erase every previous string from browser memory. An already compromised browser profile is outside this tool's protection.

Automated checks use synthetic keys and fresh isolated browser contexts only. The browser fixture routes a virtual test origin to an ephemeral loopback server; it never listens on the owner's real port 8787 or uses an installed browser profile. They verify consent, zero writes, missing/corrupt/changed keys, cancellation, CSP/network boundaries and a real SDK backup through the current game's authenticated restore proof. Production recovery remains a separate owner-controlled action.

```text
node --test tools/offline-character-recovery/server.test.mjs tools/offline-character-recovery/recovery-core.test.mjs
HM_PLAYWRIGHT_MODULE=PATH_TO_PLAYWRIGHT/index.mjs node --test tools/offline-character-recovery/offline-recovery.browser.test.mjs
```
