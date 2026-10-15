# Multiplayer startup recovery

A failed initial WebSocket handshake previously left a fulfilled null promise cached in `NETWS.linkP`. The room connector then stayed in `alone`, so a reachable server could remain unavailable for the rest of the session.

The client now clears completed connection attempts and retries an initial server failure after the game is ready, with one in-flight attempt and delays capped at 15 seconds. Existing room links retain their transport. Established WebSocket links keep their reconnect behavior and send the current player profile before later realm or company actions.

Credential discovery is bounded and completes before opening a socket. A confirmed missing account can use the existing guest flow; unavailable private token storage cannot create a new guest. The server's handshake deadlines and authentication rules are unchanged.

Every socket callback and timer belongs to a connection generation. Retiring a socket invalidates that identity before settling pending requests or closing it, so queued replies and delayed close events cannot affect a newer connection. Explicit closure cancels retries and heartbeat work.

## Saves

Late multiplayer recovery does not reload a character or change the selected `SAVE.ref` or `SAVE.backend`. A session that started locally keeps saving locally. A remote save reference also captures the account id and server host it was created for; reads, writes and wipes reject a different owner. A save request timeout retires the whole socket because the existing protocol identifies replies by order rather than request ids.

## Verification

- `node --test tools/tests/net_reconnect.mjs` exercises the actual client source with controlled socket events and timers, including initial and established retries, uncertain credentials, stale callbacks, account changes, explicit close and overlapping requests whose old socket delays its close event.
- `python tools/tests/net_reconnect.py` runs Chromium against a temporary real March server. It withholds the initial welcome, resumes an existing local character, permits later connection, and verifies that new local progress does not change an existing server save.
- Both run in CI. Existing graphics, phone, gameplay, shader and long-run checks remain enabled.

For diagnosis, read the plain CPU fields `NETWS.state`, `NETWS.lastFailure`, `NETWS.lastClose` and connection counters. A solo banner identifies the session's failed connection; it does not by itself establish a server outage. No credentials need to be logged.
