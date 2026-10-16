# Native player ownership bridge

Interego remains the identity, pod, delegation, graph publication, cryptography,
discovery and composition substrate. The generic OAuth account bridge and
owner-side client compose those primitives. Hallowmarch supplies only its
participation relationship and private character record schema. I2IDL-X is not
used to define any game identity, item, combat, world or economy model.

The owner signs in through the relay's advertised OAuth metadata using PKCE.
The game verifies the authenticated native pod status, canonical identity and
registered session agent. A short-lived game session records that verification;
the caller cannot provide its own trusted DID. A Hallowmarch-owned native ledger
retains participation and the reference to the player's private record. Returning
with the same native identity restores the same participation account.

The access grant reaches only the initiating browser through a one-use,
cookie/account/session-bound claim. No native token appears in a URL, game
account file or game session token. Refresh tokens are discarded. An access
grant can be restored until its existing expiry from a purpose-bound encrypted
browser cache, using the reviewed Interego ClientKeyVault. Restoration must
probe the native service again; the cache cannot determine revocation offline.
Sign-out closes the client and forgets the encrypted access cache.

The player's browser creates and keeps its own encryption key. The pod receives
only its public recipient key and sealed character records, signed by the
authenticated native publishing agent. The recovery file uses the existing SDK
encrypted backup contract. Neither the private key nor recovery passphrase is
sent to Hallowmarch. A second browser must restore the correct recovery key;
reading a missing key never silently creates a replacement.

The character's save reference implements the existing asynchronous save port.
Its body is never posted to the game bridge. Updates require the previously read
native head and CAS. A new record uses a random graph IRI because this substrate
does not advertise atomic compare-with-absence. A save is confirmed only after
native head, signed digest, owner binding and local decrypt readback. Delayed or
lost acknowledgements remain pending and are confirmed before another update.
The game receives only a pod record reference. Failed relationship publication
is separately reported and can be repaired without rewriting the private body.

The simulation never waits on these writes. The native save pipeline retains
unconfirmed latest progress in memory and retries it; it does not acknowledge a
local cache or game-server file as a successful private pod save. A browser that
closes before confirmation may lose uncommitted progress. Recovery files restore
committed ciphertext, not progress that never reached the pod.

Old personal save files are retained read-only for an explicit owner import.
Importing preserves their player-authored provenance and does not turn currency,
loot or local war snapshots into signed authoritative multiplayer outcomes.
Native-bound accounts reject central personal save/load/wipe operations. Ordinary
legacy accounts remain a compatibility path until deliberately connected.

This is a private-character and identity bridge. The bounded shared expedition
remains separate from the legacy main-world simulation. Native agent proof,
player-authorized autonomous writes, team/realm/season ownership migration and
signed cross-owner authoritative outcome receipts require their own composed
contracts. This change does not claim those migrations or MMO-scale capacity.
