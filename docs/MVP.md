# Connected MVP

## Customer promise

When a production application fails, Software Oath gathers the incident, prepares
a reviewable repair, runs the application's required checks, and explains which
promises passed, failed, or still require human judgment.

## First supported environment

- TypeScript applications hosted on GitHub.
- GitHub Actions or npm-based test commands.
- Sentry as the first incident source.
- GitHub pull requests as the only repair-delivery mechanism.
- Customer-controlled or Software Oath-managed isolated runners.
- Human approval required for every pull request.

Automatic production deployment is explicitly outside the first MVP.

## End-to-end acceptance scenario

The first real demo is complete only when all of these happen without editing
database state manually:

1. A customer installs the Software Oath GitHub App on one repository.
2. Software Oath reads `software-oath.yml` from the default branch.
3. A Sentry issue creates an incident with stack trace and release commit.
4. A runner checks out the exact failing commit in an isolated writable workspace.
5. The failure is reproduced by a committed regression test.
6. A repair agent creates a minimal patch on a new branch.
7. Every required oath check executes against the patched branch.
8. Software Oath inspects the patched branch again and proves that the selected
   finding disappeared without introducing a new critical or high-severity finding.
9. The evidence report identifies passed, failed, missing, and human-review rules.
10. A GitHub pull request contains the patch and links to the evidence report.
11. Software Oath cannot approve or merge while required evidence is failed or missing.
12. A human can approve a review-required rule with an identity and written reason.
13. The final receipt records the repository, commits, commands, results, finding
    delta, agent version, approvals, and timestamps.

## Success measures

- At least 5 historical production incidents replayed.
- At least 3 correctly reproduced.
- At least 2 produce maintainable pull requests accepted by engineers.
- Zero repairs merged with failed required evidence.
- Every decision can be reconstructed from its receipt.
- Median investigation time is materially lower than the original human incident.

## Non-goals

- Maintaining arbitrary programming languages.
- Automatically discovering every business rule.
- Mathematical proof of an entire application.
- Running private source on anonymous marketplace computers.
- Automatic database migrations.
- Automatic production deployment.
- Replacing code owners or incident commanders.

## Build sequence

0. Repository-local maintainer, executable evidence, and receipts.
1. Bounded maintenance-problem detectors. **Implemented locally:** tracked secret
   files, missing JavaScript lockfiles, oversized source files, and failed
   repository-defined oath commands.
2. Isolated writable runner. **Implemented with pluggable local and constrained
   ephemeral Docker runners.**
3. Repair-agent adapter. **Implemented locally with Codex CLI.**
4. Git patch and evidence package. **Implemented locally with disposable worktrees.**
5. Scheduled GitHub Action and pull-request delivery. **Implemented as a
   split-permission reusable action and workflow template.**
6. GitHub App installation and hosted run history. **Authentication, workflow
   dispatch, encrypted manifest conversion, draft PR delivery, durable history
   API, and Runs UI implemented.**
7. Sentry incident ingestion. **Signed webhook verification, normalization, and
   deduplication implemented.**
8. Approval identities and signed receipts. **Implemented with identified,
   durable decisions and canonical Ed25519-signed repair receipts.**
9. Historical-incident replay pilot. **Replay command and benchmark report
   implemented with a five-incident PlanetNode suite.**

The product is developed from the maintenance engine outward. Authentication,
the hosted dashboard, billing, and marketing pages are not prerequisites for
proving that the maintainer can find, repair, and verify a real repository problem.
