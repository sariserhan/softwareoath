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
8. The evidence report identifies passed, failed, missing, and human-review rules.
9. A GitHub pull request contains the patch and links to the evidence report.
10. Software Oath cannot approve or merge while required evidence is failed or missing.
11. A human can approve a review-required rule with an identity and written reason.
12. The final receipt records the repository, commits, commands, results, agent version,
    approvals, and timestamps.

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
   files, missing JavaScript lockfiles, unresolved source markers, and oversized
   source files.
2. Isolated writable runner.
3. Repair-agent adapter.
4. Git patch and evidence package.
5. GitHub App and pull-request delivery.
6. Scheduled maintenance runs.
7. Sentry incident ingestion.
8. Approval identities and signed receipts.
9. Historical-incident replay pilot.

The product is developed from the maintenance engine outward. Authentication,
the hosted dashboard, billing, and marketing pages are not prerequisites for
proving that the maintainer can find, repair, and verify a real repository problem.
