import { spawn } from "node:child_process";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const checks = [];
let active;
let interrupted = false;
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => {
    interrupted = true;
    active?.kill("SIGTERM");
  });

async function run(label, command, args) {
  if (interrupted) throw new Error("Verification interrupted");
  console.log(`\n[PHASE 12] ${label}`);
  const started = Date.now();
  const child =
    command === "pnpm" && process.platform === "win32"
      ? spawn("cmd.exe", ["/d", "/s", "/c", ["pnpm", ...args].join(" ")], {
          cwd: root,
          stdio: "inherit",
          windowsHide: true,
        })
      : spawn(command, args, {
          cwd: root,
          stdio: "inherit",
          windowsHide: true,
        });
  active = child;
  const code = await new Promise((accept, reject) => {
    child.once("error", reject);
    child.once("exit", (exitCode, signal) =>
      accept(exitCode ?? (signal ? 1 : 0)),
    );
  });
  active = undefined;
  checks.push({ label, exitCode: code, durationMs: Date.now() - started });
  if (code !== 0) throw new Error(`${label} failed (${code})`);
}

try {
  await run("Frozen workspace install", "pnpm", [
    "install",
    "--frozen-lockfile",
  ]);
  await run("Dependency peer compatibility", "pnpm", ["peers", "check"]);
  await run("Shared ESM packages", "pnpm", ["build:packages"]);
  for (const app of [
    "api-gateway",
    "indexer-service",
    "portfolio-service",
    "web",
  ])
    await run(`${app} production build`, "pnpm", [
      "--dir",
      `apps/${app}`,
      "build",
    ]);
  await run("Backend type-aware and frontend lint", "pnpm", ["lint"]);
  await run("All application/shared unit tests", "pnpm", ["test:unit"]);
  await run("Test fixture strict types", "pnpm", [
    "--dir",
    "tests",
    "typecheck",
  ]);
  await run("Actual response and event contracts", "pnpm", ["test:contracts"]);
  await run(
    "PostgreSQL migrations/ownership, Redis/BullMQ, RabbitMQ, backup/restore integration",
    "pnpm",
    ["test:integration"],
  );
  await run(
    "Real-app auth/ownership/explorer/intelligence/security/outbox/traces/WebSocket/resilience e2e",
    "pnpm",
    ["test:e2e"],
  );
  await run("Measured source coverage and critical thresholds", "pnpm", [
    "test:coverage",
  ]);
  await run("Test helper compilation", "pnpm", ["build:test-helpers"]);
  await run(
    "Deterministic SQL/HTTP/indexer/WebSocket performance and cleanup",
    process.execPath,
    ["scripts/performance/indexer-benchmark.mjs"],
  );
  await run(
    "Production Compose, 4 Docker images, health, private boundaries, OTel, SIGTERM and owned cleanup",
    process.execPath,
    ["infrastructure/scripts/verify-production.mjs", "--observability"],
  );
  await run("Development observability Compose validation", "docker", [
    "compose",
    "--env-file",
    ".env",
    "-f",
    "infrastructure/compose.observability.yml",
    "config",
    "--quiet",
  ]);
  const files = [
    "README.md",
    "docs/architecture-final.md",
    "docs/database-final.md",
    "docs/security-final.md",
    "docs/operations-final.md",
    "docs/study-project.md",
    "docs/production-checklist.md",
    "docs/phase-12-production-hardening.md",
  ];
  for (const file of files)
    if ((await readFile(resolve(root, file), "utf8")).trim().length < 500)
      throw new Error(`Final documentation is incomplete: ${file}`);
  checks.push({
    label: "README and seven substantive final documents",
    exitCode: 0,
  });
  console.log(
    `\nPHASE 12: ${checks.length} verification groups passed; no skipped checks.`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : "Verification failed");
  process.exitCode = 1;
} finally {
  await mkdir(resolve(root, "artifacts"), { recursive: true });
  await writeFile(
    resolve(root, "artifacts/phase-12-verification.json"),
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        success: process.exitCode !== 1,
        checks,
      },
      null,
      2,
    ) + "\n",
  );
}
