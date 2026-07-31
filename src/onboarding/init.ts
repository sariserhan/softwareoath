import { execFile } from "node:child_process";
import {
  access,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { promisify } from "node:util";
import { stringify } from "yaml";

import type { EvidenceKind, OathRule, SoftwareOath } from "../domain/types";

const execFileAsync = promisify(execFile);

interface DiscoveredCheck {
  id: string;
  title: string;
  description: string;
  command: string;
  kind: EvidenceKind;
  severity: OathRule["severity"];
}

export interface InitializationResult {
  repositoryPath: string;
  oathPath: string;
  created: boolean;
  source: string;
  discoveredChecks: DiscoveredCheck[];
  warnings: string[];
}

interface InitializeOptions {
  repositoryPath: string;
  force?: boolean;
  dryRun?: boolean;
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function packageChecks(
  repositoryPath: string,
): Promise<DiscoveredCheck[]> {
  const manifestPath = join(repositoryPath, "package.json");
  if (!(await exists(manifestPath))) return [];
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as {
    scripts?: Record<string, string>;
  };
  const scripts = manifest.scripts ?? {};
  const packageManager = (await exists(join(repositoryPath, "pnpm-lock.yaml")))
    ? "pnpm"
    : (await exists(join(repositoryPath, "yarn.lock")))
      ? "yarn"
      : (await exists(join(repositoryPath, "bun.lock"))) ||
          (await exists(join(repositoryPath, "bun.lockb")))
        ? "bun"
        : "npm";
  const command = (name: string) =>
    packageManager === "npm" && name === "test"
      ? "npm test"
      : `${packageManager} run ${name}`;
  const checks: DiscoveredCheck[] = [];

  if (scripts.test && !scripts.test.includes("no test specified")) {
    checks.push({
      id: "application.tests",
      title: "Application tests remain green",
      description: "The repository's declared test suite must pass.",
      command: command("test"),
      kind: "test",
      severity: "high",
    });
  }
  for (const [name, title, description, severity] of [
    [
      "build",
      "Application remains buildable",
      "The repository's declared production build must succeed.",
      "high",
    ],
    [
      "lint",
      "Static analysis remains green",
      "The repository's declared lint command must pass.",
      "medium",
    ],
    [
      "typecheck",
      "Type validation remains green",
      "The repository's declared type validation must pass.",
      "medium",
    ],
  ] as const) {
    if (scripts[name]) {
      checks.push({
        id: `application.${name}`,
        title,
        description,
        command: command(name),
        kind: "command",
        severity,
      });
    }
  }
  return checks;
}

async function makeChecks(repositoryPath: string): Promise<DiscoveredCheck[]> {
  const makefilePath = join(repositoryPath, "Makefile");
  if (!(await exists(makefilePath))) return [];
  const source = await readFile(makefilePath, "utf8");
  return [
    ["test", "Application tests remain green", "test", "high"],
    ["build", "Application remains buildable", "command", "high"],
    ["lint", "Static analysis remains green", "command", "medium"],
  ].flatMap(([target, title, kind, severity]) =>
    new RegExp(`^${target}:`, "m").test(source)
      ? [
          {
            id: `application.${target}`,
            title,
            description: `The repository's make ${target} target must succeed.`,
            command: `make ${target}`,
            kind: kind as EvidenceKind,
            severity: severity as OathRule["severity"],
          },
        ]
      : [],
  );
}

async function ecosystemChecks(
  repositoryPath: string,
): Promise<DiscoveredCheck[]> {
  const checks: DiscoveredCheck[] = [];
  const add = (
    id: string,
    title: string,
    description: string,
    command: string,
    kind: EvidenceKind,
    severity: OathRule["severity"],
  ) => checks.push({ id, title, description, command, kind, severity });

  if (await exists(join(repositoryPath, "Cargo.toml"))) {
    add("application.rust_tests", "Rust tests remain green", "Cargo tests must pass.", "cargo test", "test", "high");
    add("application.rust_build", "Rust application remains buildable", "Cargo build must pass.", "cargo build", "command", "high");
  }
  if (await exists(join(repositoryPath, "go.mod"))) {
    add("application.go_tests", "Go tests remain green", "All Go package tests must pass.", "go test ./...", "test", "high");
    add("application.go_build", "Go application remains buildable", "All Go packages must compile.", "go build ./...", "command", "high");
  }
  const pythonFiles = ["pyproject.toml", "pytest.ini", "requirements.txt"];
  const pythonSources = (
    await Promise.all(
      pythonFiles.map(async (file) =>
        (await exists(join(repositoryPath, file)))
          ? readFile(join(repositoryPath, file), "utf8")
          : "",
      ),
    )
  ).join("\n");
  if (/pytest/i.test(pythonSources)) {
    add("application.python_tests", "Python tests remain green", "Pytest must pass.", "python -m pytest", "test", "high");
  }
  if (/\bruff\b/i.test(pythonSources)) {
    add("application.python_lint", "Python static analysis remains green", "Ruff must pass.", "python -m ruff check .", "command", "medium");
  }
  if (await exists(join(repositoryPath, "pom.xml"))) {
    const mvn = (await exists(join(repositoryPath, "mvnw"))) ? "./mvnw" : "mvn";
    add("application.maven_tests", "Java tests remain green", "Maven verification must pass.", `${mvn} verify`, "test", "high");
  }
  if (
    (await exists(join(repositoryPath, "build.gradle"))) ||
    (await exists(join(repositoryPath, "build.gradle.kts")))
  ) {
    const gradle = (await exists(join(repositoryPath, "gradlew")))
      ? "./gradlew"
      : "gradle";
    add("application.gradle_tests", "Gradle tests remain green", "Gradle tests must pass.", `${gradle} test`, "test", "high");
  }
  if (await exists(join(repositoryPath, "Package.swift"))) {
    add("application.swift_tests", "Swift tests remain green", "Swift Package tests must pass.", "swift test", "test", "high");
  }
  const rootFiles = await readdir(repositoryPath).catch(() => []);
  const solution = rootFiles.find((file) => file.endsWith(".sln"));
  if (solution) {
    add("application.dotnet_tests", ".NET tests remain green", "The .NET solution tests must pass.", `dotnet test ${JSON.stringify(solution)}`, "test", "high");
  }

  // Universal Container / Docker discovery
  if (await exists(join(repositoryPath, "Dockerfile"))) {
    add("application.docker_build", "Container image remains buildable", "The Dockerfile build must succeed.", "docker build -t software-oath-build .", "command", "high");
  }
  if ((await exists(join(repositoryPath, "docker-compose.yml"))) || (await exists(join(repositoryPath, "compose.yml")))) {
    add("application.docker_compose", "Container services remain valid", "Docker compose configuration must build.", "docker compose build", "command", "medium");
  }

  // Universal Taskfile / Justfile discovery
  if ((await exists(join(repositoryPath, "Taskfile.yml"))) || (await exists(join(repositoryPath, "Taskfile.yaml")))) {
    add("application.task_test", "Taskfile validation target remains green", "The task test target must pass.", "task test", "test", "high");
  }
  if (await exists(join(repositoryPath, "Justfile"))) {
    add("application.just_test", "Justfile validation target remains green", "The just test target must pass.", "just test", "test", "high");
  }

  // Universal CMake discovery
  if (await exists(join(repositoryPath, "CMakeLists.txt"))) {
    add("application.cmake_test", "CMake CTest suite remains green", "CTest must complete successfully.", "ctest --output-on-failure", "test", "high");
  }

  // Universal GitHub Actions workflow discovery
  const workflowDir = join(repositoryPath, ".github", "workflows");
  if (await exists(workflowDir)) {
    try {
      const workflowFiles = (await readdir(workflowDir)).filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"));
      for (const wFile of workflowFiles) {
        const content = await readFile(join(workflowDir, wFile), "utf8");
        const runSteps = Array.from(content.matchAll(/run:\s*(.+)$/gm)).map((m) => m[1].trim());
        for (const runCmd of runSteps) {
          if (/\b(?:test|pytest|cargo test|go test|npm test|vitest|jest|make test)\b/i.test(runCmd)) {
            const name = wFile.replace(/\.(?:yml|yaml)$/, "");
            add(`workflow.${name}_test`, `GitHub Workflow (${name}) test step remains green`, `Discovered workflow command: ${runCmd}`, runCmd, "test", "high");
            break;
          }
        }
      }
    } catch {
      // Ignore workflow read errors
    }
  }

  return checks;
}

function uniqueChecks(checks: DiscoveredCheck[]): DiscoveredCheck[] {
  const seen = new Set<string>();
  return checks.filter((check) => {
    if (seen.has(check.id)) return false;
    seen.add(check.id);
    return true;
  });
}

async function repositorySlug(repositoryPath: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["config", "--get", "remote.origin.url"],
      { cwd: repositoryPath },
    );
    const match = stdout.trim().match(/[:/]([^/:]+)\/([^/]+?)(?:\.git)?$/);
    if (match) return `${match[1]}/${match[2]}`;
  } catch {
    // A local-only repository receives a stable placeholder slug.
  }
  return `local/${basename(repositoryPath)}`;
}

export async function initializeRepository(
  options: InitializeOptions,
): Promise<InitializationResult> {
  const repositoryPath = resolve(options.repositoryPath);
  const oathPath = join(repositoryPath, "software-oath.yml");
  await execFileAsync("git", ["rev-parse", "--show-toplevel"], {
    cwd: repositoryPath,
  }).catch(() => {
    throw new Error("Software Oath initialization requires a Git repository.");
  });
  if ((await exists(oathPath)) && !options.force) {
    throw new Error(
      "software-oath.yml already exists. Use --force only after reviewing the existing oath.",
    );
  }

  const discoveredChecks = uniqueChecks([
    ...(await packageChecks(repositoryPath)),
    ...(await makeChecks(repositoryPath)),
    ...(await ecosystemChecks(repositoryPath)),
  ]);
  const warnings: string[] = [];
  const rules: OathRule[] =
    discoveredChecks.length > 0
      ? discoveredChecks.map((check) => ({
          id: check.id,
          title: check.title,
          description: check.description,
          severity: check.severity,
          evidence: [
            {
              kind: check.kind,
              command: check.command,
              required: true,
              timeoutMs: 600_000,
            },
          ],
        }))
      : [
          {
            id: "application.behavior",
            title: "Application behavior remains valid",
            description:
              "A maintainer must review application behavior until executable evidence is configured.",
            severity: "high",
            evidence: [{ kind: "review", required: true }],
          },
        ];
  if (discoveredChecks.length === 0) {
    warnings.push(
      "No safe executable commands were discovered. Replace the review rule with repository-owned validation commands.",
    );
  }
  warnings.push(
    "Automatic repair is disabled. Add a narrow repair.allowedPaths list and set automaticCandidate only after reviewing each rule.",
  );

  const oath: SoftwareOath = {
    version: 1,
    application: {
      name: basename(repositoryPath),
      repository: await repositorySlug(repositoryPath),
      defaultBranch:
        (
          await execFileAsync("git", ["branch", "--show-current"], {
            cwd: repositoryPath,
          })
        ).stdout.trim() || "main",
    },
    approval: {
      requireHumanFor: ["critical"],
      allowAutomaticMerge: false,
    },
    rules,
  };
  const source = stringify(oath, { lineWidth: 100 });
  if (!options.dryRun) await writeFile(oathPath, source, "utf8");

  return {
    repositoryPath,
    oathPath,
    created: !options.dryRun,
    source,
    discoveredChecks,
    warnings,
  };
}
