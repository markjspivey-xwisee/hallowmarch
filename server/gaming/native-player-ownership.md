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

The encrypted character and its encrypted discovery index belong to that player
in the player's pod. A fresh browser discovers the owner index before following
any game-held reference; recovery also requires the player's correct encryption
key. The game-held reference is a repairable hint, not the authority for finding
or replacing the player's character. Uncertain index publication keeps the same
pending operation and cannot authorize another character or replacement key.

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
Native-bound accounts reject central personal save/load/wipe operations. A server
without a configured native bridge retains its existing legacy behavior and does
not advertise a native entry policy. A configured native bridge keeps its contract
visible during an outage, so unresolved ownership cannot select a browser save.
`HM_NATIVE_PLAYER_REQUIRED=1` additionally enforces verified native participation
at the server: unverified accounts cannot send world updates, enter the shared
expedition or write central personal files. The sign-in transport remains usable.

This is a private-character and identity bridge over the hosted native provider.
The bounded shared expedition remains separate from main-world combat, which
uses elected page/region keepers. Game-owned world/season persistence and native
companion authority have their own [checkpoint](progressive-owned-state.md) and
[delegation](native-agent-authority.md) contracts. Enable those composed paths
only after their deployment and live proof gates pass. Team/realm ownership and
permissions and signed cross-owner authoritative outcomes remain outside this migration. Native
sign-in and gameplay delegation do not grant learning consent or configure the
trusted subject delivery path; personal learning export remains unavailable.
This change does not establish MMO-scale capacity.
