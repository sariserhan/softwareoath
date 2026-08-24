# Isolated runner security

Software Oath treats repository contents, commands, patches, logs, and build
artifacts as untrusted. Hosted verification must use the Docker runner or a
stronger implementation of the same interface. It must never fall back to local
worker execution.

## Local topology

Docker Compose builds `software-oath-runner:local`. The worker sends authenticated
requests to an internal runner broker. The broker and ephemeral runner containers
share only the named `software-oath-workspaces` volume. Only the broker receives
the Docker socket; it receives no database, GitHub, OAuth, signing, or operator
credentials.

The worker configures:

```env
SOFTWARE_OATH_RUNNER_BROKER_URL=http://runner-broker:8790
SOFTWARE_OATH_RUNNER_BROKER_TOKEN=<independent random secret>
```

Both values are required by the worker. Missing broker configuration stops it.
The broker separately owns the image and shared-volume configuration.

## Infracost cost-analysis boundary

Cost analysis is opt-in repository policy and requires an operator-provided
`INFRACOST_API_KEY`. Infracost can transmit infrastructure-derived data to its
external pricing service and can download provider plugins. Operators must obtain
the repository owner's authorization for that transfer before enabling the key.

The worker never receives the Infracost API key. It sends an authenticated request
to the broker's dedicated `/cost-analysis` route. That route validates a three-letter
currency and runs only this fixed operation in a fresh bridge-networked container:

```text
INFRACOST_CURRENCY=<ISO> infracost breakdown --path . --format json --show-skipped --no-cache --out-file /tmp/infracost.json
```

The key is inherited by environment name only by that cost container; it is not
placed in Docker command arguments or made available to generic `/execute` jobs.
The automation-compatible CLI from the linked `infracost/infracost` repository is pinned to v0.10.45 in `Dockerfile.runner`, and both AMD64 and ARM64 archives
are verified against release SHA-256 checksums during the trusted image build.

Software Oath scans the immutable base checkout and proposed worktree separately.
It stores both raw JSON documents, records their SHA-256 digests in the signed repair
receipt, verifies those digests when artifacts are saved and read, and includes the
cost decision and digests in the final owner attestation. Required unavailable
analysis and configured threshold overruns fail closed.

## Container controls

Each evidence command runs in a new container with:

- Network disabled by default.
- All Linux capabilities dropped.
- `no-new-privileges`.
- A read-only container root filesystem.
- A bounded writable `/tmp` tmpfs.
- CPU, memory, process, output, and wall-clock limits.
- A workspace disk limit enforced before execution, inherited as a file-size
  limit, and checked again against aggregate workspace usage after execution.
- No inherited application environment or credentials.
- A fixed temporary home and npm cache under the bounded `/tmp` mount.
- An explicitly selected workspace mount.
- Forced container removal after completion or timeout.
- Pulling disabled during execution; operators prepare images separately.

Before hosted analysis, tracked symlinks are rejected if their target escapes the
repository root. Git submodules are rejected until a separately authenticated,
commit-pinned submodule checkout policy is implemented. Software Oath does not
extract repository-provided archives.

## Production requirements

Production images must be built by a trusted pipeline, scanned, signed, and
configured by immutable digest:

```env
SOFTWARE_OATH_RUNNER_IMAGE=ghcr.io/example/software-oath-runner@sha256:<digest>
```

The Docker broker remains part of the local MVP topology. Production should
replace it with a separately hosted broker or short-lived microVM service.

For npm repairs, a separate preparation container receives bridge networking
only after Software Oath validates that every lockfile `resolved` URL uses
`https://registry.npmjs.org`. It runs the fixed command `npm ci` with
`--ignore-scripts`, audit and funding requests disabled, and registry host
replacement enabled. Oath verification then runs in a new network-disabled
container.

Non-npm toolchains and an isolated generative repair-agent service remain
separate roadmap gates.
