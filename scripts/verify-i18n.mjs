import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createServer } from "node:net";
import { randomBytes } from "node:crypto";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const webRoot = resolve(root, "apps/web");
const runId = randomBytes(8).toString("hex");
const distName = `.next-i18n-${runId}`;
const configName = `.next-i18n-${runId}.tsconfig.json`;
const output = resolve(webRoot, distName);
const tsconfig = resolve(webRoot, configName);
const nextEnv = resolve(webRoot, "next-env.d.ts");
const originalNextEnv = await readFile(nextEnv);
const webEnv = {
  ...process.env,
  NEXT_TELEMETRY_DISABLED: "1",
  WEB_BUILD_DIR: distName,
  WEB_TSCONFIG_PATH: configName,
};
const checks = [];
let server;
let interrupted = false;
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => {
    interrupted = true;
    if (server?.connected) server.send({ type: "i18n-stop" });
  });

async function command(label, executable, args, env = process.env) {
  if (interrupted) throw new Error("Localization verification interrupted");
  console.log(`\n[I18N] ${label}`);
  const child =
    executable === "pnpm" && process.platform === "win32"
      ? spawn("cmd.exe", ["/d", "/s", "/c", ["pnpm", ...args].join(" ")], {
          cwd: root,
          env,
          stdio: "inherit",
          windowsHide: true,
        })
      : spawn(executable, args, {
          cwd: root,
          env,
          stdio: "inherit",
          windowsHide: true,
        });
  const code = await new Promise((accept, reject) => {
    child.once("error", reject);
    child.once("exit", (value) => accept(value));
  });
  if (code !== 0) throw new Error(`${label} failed (${code})`);
  checks.push(label);
}
async function port() {
  const listener = createServer();
  await new Promise((accept) => listener.listen(0, "127.0.0.1", accept));
  const address = listener.address();
  assert.ok(address && typeof address !== "string");
  await new Promise((accept, reject) =>
    listener.close((error) => (error ? reject(error) : accept())),
  );
  return address.port;
}
async function stop() {
  if (!server || server.exitCode !== null || server.signalCode !== null) return;
  const exit = new Promise((accept) => server.once("exit", accept));
  server.send({ type: "i18n-stop" });
  let timeout;
  try {
    await Promise.race([
      exit,
      new Promise((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error("Web shutdown deadline exceeded")),
          15000,
        );
      }),
    ]);
  } catch (error) {
    server.kill("SIGKILL");
    await exit;
    throw error;
  } finally {
    clearTimeout(timeout);
  }
  assert.ok(
    [0, 143].includes(server.exitCode),
    `Unexpected web shutdown exit code: ${server.exitCode}`,
  );
}

try {
  await writeFile(
    tsconfig,
    JSON.stringify(
      {
        extends: "./tsconfig.json",
        compilerOptions: { incremental: false },
        include: [
          "next-env.d.ts",
          "src/**/*.ts",
          "src/**/*.tsx",
          `${distName}/types/**/*.ts`,
          `${distName}/dev/types/**/*.ts`,
        ],
        exclude: ["node_modules"],
      },
      null,
      2,
    ) + "\n",
  );
  await command("Strict dictionary keys and interpolation types", "pnpm", [
    "--dir",
    "apps/web",
    "exec",
    "tsc",
    "--noEmit",
    "--incremental",
    "false",
  ]);
  await command(
    "All frontend tests: dictionary parity, switching, persistence, formatting, safe errors and UI",
    "pnpm",
    ["--dir", "apps/web", "test"],
  );
  await command("Hardcoded presentation string audit", process.execPath, [
    "scripts/audit-i18n.mjs",
  ]);
  await command("Frontend lint", "pnpm", ["--dir", "apps/web", "lint"]);
  await command(
    "Isolated frontend production build",
    "pnpm",
    ["--dir", "apps/web", "build"],
    webEnv,
  );
  const next = createRequire(resolve(webRoot, "package.json")).resolve(
    "next/dist/bin/next",
  );
  const selectedPort = await port();
  const wrapper = `process.on('message',m=>{if(m?.type==='i18n-stop')process.emit('SIGTERM','SIGTERM')});process.argv=[process.execPath,${JSON.stringify(next)},'start','--port',${JSON.stringify(String(selectedPort))},'--hostname','127.0.0.1'];await import(${JSON.stringify(pathToFileURL(next).href)})`;
  server = spawn(process.execPath, ["--input-type=module", "--eval", wrapper], {
    cwd: webRoot,
    env: webEnv,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  let logs = "";
  for (const stream of [server.stdout, server.stderr])
    stream.on("data", (chunk) => {
      logs = (logs + chunk.toString()).slice(-5000);
    });
  const base = `http://127.0.0.1:${selectedPort}`;
  const deadline = Date.now() + 45000;
  let ready = false;
  while (Date.now() < deadline) {
    if (server.exitCode !== null)
      throw new Error(
        `Production web startup failed (${server.exitCode}); ${logs.includes("Error") ? "inspect the isolated build output" : "process exited"}`,
      );
    try {
      ready = (await fetch(base, { signal: AbortSignal.timeout(2000) })).ok;
    } catch {}
    if (ready) break;
    await new Promise((accept) => setTimeout(accept, 250));
  }
  assert.equal(ready, true);
  const paths = [
    "/",
    "/search",
    "/blocks",
    "/blocks/100",
    "/tx/0x" + "3".repeat(64),
    "/address/0x" + "1".repeat(40),
    "/tokens",
    "/token/0x" + "a".repeat(40),
    "/contract/0x" + "c".repeat(40),
    "/login",
    "/register",
    "/dashboard",
    "/portfolio",
    "/portfolio/00000000-0000-4000-8000-000000000001",
    "/watchlists",
    "/watchlists/00000000-0000-4000-8000-000000000001",
    "/alerts",
    "/settings",
    "/i18n-missing-page",
  ];
  for (const [cookie, locale] of [
    ["", "kk"],
    ["locale=en", "en"],
    ["locale=kk", "kk"],
    ["locale=invalid", "kk"],
  ]) {
    for (const path of paths) {
      const response = await fetch(base + path, {
        headers: cookie ? { Cookie: cookie } : {},
        signal: AbortSignal.timeout(10000),
      });
      assert.equal(
        response.status,
        path === "/i18n-missing-page" ? 404 : 200,
        path,
      );
      const html = await response.text();
      assert.match(html, new RegExp(`<html[^>]*lang="${locale}"`), path);
      assert.ok(html.includes(locale === "kk" ? "Блоктар" : "Blocks"), path);
      assert.ok(html.includes('aria-pressed="true"'), path);
      assert.ok(!html.includes("Missing translation:"), path);
      if (path === "/login")
        assert.ok(html.includes(locale === "kk" ? "Құпиясөз" : "Password"));
      if (path === "/i18n-missing-page")
        assert.ok(
          html.includes(locale === "kk" ? "Бет табылмады" : "Page not found"),
        );
    }
    checks.push(
      `Production SSR ${cookie || "default kk"}: ${paths.length} routes, matching HTML locale and interface`,
    );
  }
  await stop();
  checks.push("Own production server shutdown");
  console.log(
    `\nLocalization verification: ${checks.length} groups passed, ${paths.length * 4} production SSR responses validated.`,
  );
} finally {
  try {
    await stop();
  } finally {
    const currentNextEnv = await readFile(nextEnv);
    if (currentNextEnv.toString().includes(distName))
      await writeFile(nextEnv, originalNextEnv);
    assert.ok(output.startsWith(webRoot + sep) && output.endsWith(distName));
    await rm(output, { recursive: true, force: true });
    await rm(tsconfig, { force: true });
    await mkdir(resolve(root, "artifacts"), { recursive: true });
    await writeFile(
      resolve(root, "artifacts/i18n-verification.json"),
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          checks,
          success: checks.length === 10,
        },
        null,
        2,
      ) + "\n",
    );
  }
}
