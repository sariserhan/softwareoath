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
