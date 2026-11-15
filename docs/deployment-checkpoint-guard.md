# Native checkpoint guard before planned deployment

Run this against every original running game process before accepting its replacement:

```sh
node tools/deploy-preflight.mjs https://march-production-f6d9.up.railway.app https://march-native-preview-production.up.railway.app
```

The command refuses unavailable originals, active human play, pending or writing snapshots, storage errors, a native fence, and mismatched live/confirmed versions. It checks the idle original process again after observing its checkpoint and refuses a changed checkpoint.

This is an operator preflight, not a request to create or seed data. It does not freeze new admissions, save RAM, restore an already stopped process, or make a Railway deploy atomic. Keep player admission stopped through the rollout and rerun the check immediately before the deployment action. Do not override a refusal by restarting the original process. Verify its native checkpoint through recovery first.

A known `CHECKPOINT_UNCONFIRMED` error now fences further shared-world/season mutations. Existing native retry/readback or explicit native recovery can clear that error. No separate file or SQL authority is added.

Ordinary realtime room actions still report live acceptance with `durable:false`; protected loot-credit and permission actions wait for native durability. Main-world contribution/order responses retain their existing acknowledgement semantics. This guard blocks further mutations after a known checkpoint outage; it does not redesign unknown-outcome retries or recover unconfirmed state from the stopped process.
