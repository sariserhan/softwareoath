# Software Oath private beta contract

The private beta supports GitHub repositories using npm with a committed
`package-lock.json`, a supported Node.js release, repository-owned deterministic tests,
and a reviewable `software-oath.yml`. Monorepos are supported only where the affected npm
workspace and lockfile are detected unambiguously. Other ecosystems are discovery-only
until their individual M8 readiness gate passes.

Software Oath creates draft pull requests only. It never approves, merges, deploys,
rotates secrets, changes DNS, or performs database migrations. Repository owners retain
final review authority. Repairs are bounded to declared paths and require reproduction,
before/after proof, repository verification, CI, and signed evidence.

Beta source is used only to provide the service, is not used to train models, and is
handled under the published data and security controls. Owners may disconnect the GitHub
App and use the authenticated repository deletion action. Support is best-effort during
the private beta; security issues and evidence-gate failures take priority over feature
requests. Abuse, credential extraction, bypassing repository authorization, malware,
and attempts to use the runner for unrelated computation are prohibited.

Beta evaluation records privacy-preserving repository digests, workflow stage outcomes,
reproduction and CI failures, rejected patches, review duration, accepted repairs, and
whether intervention was required. Repository contents, patches, tokens, and secret
values are excluded from product metrics.
