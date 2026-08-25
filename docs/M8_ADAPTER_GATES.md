# M8 ecosystem adapter gates

Every ecosystem adapter remains discovery-only or advisory-only until its own
`evaluateAdapterReadiness` report passes. Recognition never implies repair support.

The gate requires read-only discovery, structured updates and advisories, a documented
network and lifecycle-script policy, conservative version selection, deterministic
manifest or lockfile updates, exact scope and before/after proof, fixtures, isolated
integration tests, one end-to-end repair, and published supported/unsupported patterns.

The planned order is pnpm, Yarn, Python, Go, Rust, Bun, Maven/Gradle, Ruby/Bundler,
PHP/Composer, then .NET/NuGet. Beta evidence may change priority, but cannot waive a
gate. The current registry fails closed by reporting coverage gaps rather than offering
automatic repairs from an incomplete adapter.
