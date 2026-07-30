# PlanetNode historical incident pilot

Run date: July 30, 2026

Result: **5 passed, 0 failed**

Each replay checked out the original buggy commit, derived regression evidence
from the original human-fix commit, confirmed the failure, allowed an AI repair
only inside declared paths, reran the evidence, and applied the before-and-after
proof gate.

| Incident | Human fix | AI decision | AI changed paths | Duration |
| --- | --- | --- | --- | ---: |
| Non-numeric pricing hardware | `dd00506` | ready | `services/api/app/pricing.py` | 92s |
| Gross/net pending payout mismatch | `0da071b` | ready | `services/api/app/schemas.py` | 81s |
| SQLite transactional DDL rollback | `1e5c810` | ready | `services/api/migrations/run_migrations.py` | 82s |
| Region whitespace normalization | `0453ce7` | ready | `services/api/app/main.py` | 69s |
| Region case normalization | `2348a28` | ready | `services/api/app/main.py`, migration SQL | 143s |

All five selected findings disappeared and none introduced a new critical or
high-severity finding. Every repair remained inside its allowlist.

The generated patches were behaviorally accepted but were not byte-for-byte
identical to the historical human patches. This is expected: the acceptance
criterion is the declared invariant and independent evidence, not textual imitation.

The aggregate machine-readable report is stored by the replay command under the
tested repository's `.git/software-oath/replay-suites/planetnode-suite.json`.
