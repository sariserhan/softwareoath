# Release and rollback operations

Software Oath releases two OCI images: `control-plane` and `runner`. A production
release must identify both images by digest, run the verification suite, and pass
the protected `production` GitHub environment before any external deployment is
requested.

## Required GitHub configuration

1. Create a `production` environment with required reviewers and prevent
   self-review.
2. Restrict deployment branches and tags to protected release tags (`v*`).
3. Add `SOFTWARE_OATH_DEPLOY_URL` as an environment variable and
   `SOFTWARE_OATH_DEPLOY_TOKEN` as an environment secret only after the target
   deployment adapter is ready.
4. Protect release tags and require the CI and Security workflows on `main`.
5. Keep package write, attestation, and identity-token permissions scoped to the
   release job.

## Release contract

A release is immutable. Build both images from one Git commit, tag them with the
release tag for readability, and deploy the digest-qualified references. Record
the Git SHA, both image digests, migration version, approver, deployment ID, and
timestamps in the deployment system and audit log.

The deployment adapter accepts an authenticated JSON request:

```json
{
  "action": "deploy",
  "release_ref": "v1.2.3",
  "release_sha": "0123456789abcdef",
  "images": {
    "control_plane": "ghcr.io/example/software-oath-control-plane@sha256:...",
    "runner": "ghcr.io/example/software-oath-runner@sha256:..."
  }
}
```

It must reject mutable-only tags, unknown digests, replayed request IDs, and any
release whose images do not share the recorded source SHA. It should return a
deployment ID and expose status until health checks succeed or the rollout fails.

## Rollback

Rollback redeploys the last known-good pair of image digests; it does not run a
down migration. Database changes follow the expand/contract policy in
[DEPLOYMENT.md](./DEPLOYMENT.md), so the previous application release must remain
compatible with the current schema.

Before approving rollback, capture the incident ID, failing deployment ID,
target known-good deployment ID, and reason. After rollback, verify `/live`,
`/ready`, worker heartbeat freshness, queue recovery, audit writes, and one
end-to-end repository check. Preserve failed-release artifacts for investigation.

## GitHub Actions workflow

The `Release and deploy` workflow publishes both images when a protected `v*`
tag is pushed. After verification, each image receives the release tag and an
immutable source-SHA tag, plus a GitHub build-provenance attestation. The
production job sends only digest-qualified image references and cannot start
until the `production` environment is approved.

Use the workflow's manual dispatch for redeployment or rollback. Supply the full
40-character SHA of an existing published release, a release or incident
reference, and a reason when rolling back. The workflow resolves the SHA tags to
registry digests before sending the command. Every request carries a stable
`Idempotency-Key`; the deployment adapter must return the prior result when that
key is replayed.

The protected environment permits release tags and manual dispatches from
`main`. It requires a reviewer. Because the repository currently has one
administrator, self-review is permitted; add a second trusted reviewer and turn
on prevention of self-review before the private beta.

## Staging evidence required before production

- Deploy and roll back the exact release images in staging.
- Restore the latest managed PostgreSQL backup into an isolated database and run
  integrity checks.
- Exercise an in-flight job across the rollout and verify lease recovery.
- Confirm alerts fire for readiness failure, stale workers, and deployment error.
- Attach commands, timestamps, image digests, database recovery output, and
  health-check results to the release record.

Production automation remains incomplete until the deployment adapter is chosen,
the protected environment is configured, and a staging deployment plus rollback
has produced this evidence.

Do not create a release tag until `SOFTWARE_OATH_DEPLOY_URL` and
`SOFTWARE_OATH_DEPLOY_TOKEN` exist in the `production` environment.
