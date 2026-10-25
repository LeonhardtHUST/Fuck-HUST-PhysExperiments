#!/usr/bin/env node
/**
 * Cross-platform entry point for the root package.json scripts.
 *
 * npm runs scripts through cmd.exe on Windows and sh on POSIX, so package.json
 * cannot call dev.ps1 or dev.sh directly. This small dispatcher picks the right
 * launcher and translates the flags:
 *
 *   npm run dev                  -> dev.ps1           / dev.sh
 *   npm run build                -> -Build            / --build
 *   npm run prod                 -> -Prod             / --prod
 *   npm run stop                 -> -Stop             / --stop
 *   npm run prod -- --no-browser -> -NoBrowser        / --no-browser
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, "..");
const isWindows = process.platform === "win32";

const TASKS = new Map([
  ["dev", { powershell: [], shell: [] }],
  ["build", { powershell: ["-Build"], shell: ["--build"] }],
  ["prod", { powershell: ["-Prod"], shell: ["--prod"] }],
  ["stop", { powershell: ["-Stop"], shell: ["--stop"] }],
]);

const FLAGS = [
  {
    names: ["--detach", "-d"],
    powershell: ["-Detach"],
    shell: ["--detach"],
  },
  {
    names: ["--install"],
    powershell: ["-Install"],
    shell: ["--install"],
  },
  {
    names: ["--no-browser"],
    powershell: ["-NoBrowser"],
    shell: ["--no-browser"],
  },
  {
    names: ["--backend-port", "-b"],
    takesValue: true,
    powershell: "-BackendPort",
    shell: "--backend-port",
  },
  {
    names: ["--frontend-port", "-f"],
    takesValue: true,
    powershell: "-FrontendPort",
    shell: "--frontend-port",
  },
];

function fail(message) {
  console.error(`error: ${message}`);
  process.exit(2);
}

const [taskName = "dev", ...rest] = process.argv.slice(2);

if (taskName === "--help" || taskName === "-h" || taskName === "help") {
  console.log(`usage: npm run <task> [-- <flags>]

tasks:
  dev     start backend + frontend with hot reload (default)
  build   build the frontend into frontend/out and exit
  prod    build, then serve frontend/out with uvicorn (no reload)
  stop    stop whatever listens on the two ports

flags (after --):
  --detach --install --no-browser --backend-port <port> --frontend-port <port>

The same options exist on the launchers themselves:
  scripts\\dev.ps1 -Prod -NoBrowser
  ./scripts/dev.sh --prod --no-browser`);
  process.exit(0);
}

const task = TASKS.get(taskName);
if (!task) {
  fail(`unknown task '${taskName}' (expected one of: ${[...TASKS.keys()].join(", ")})`);
}

const psArgs = [...task.powershell];
const shArgs = [...task.shell];

for (let i = 0; i < rest.length; i += 1) {
  const arg = rest[i];
  const flag = FLAGS.find((candidate) => candidate.names.includes(arg));
  if (!flag) fail(`unknown flag '${arg}' (see scripts/dev.sh --help for the full list)`);

  if (flag.takesValue) {
    const value = rest[i + 1];
    if (value === undefined) fail(`missing value for '${arg}'`);
    psArgs.push(flag.powershell, value);
    shArgs.push(flag.shell, value);
    i += 1;
  } else {
    psArgs.push(...flag.powershell);
    shArgs.push(...flag.shell);
  }
}

function firstAvailable(candidates, probeArgs) {
  for (const candidate of candidates) {
    const probe = spawnSync(candidate, probeArgs, { stdio: "ignore" });
    if (!probe.error) return candidate;
  }
  return null;
}

let command;
let args;

if (isWindows) {
  const powershell = firstAvailable(["pwsh", "powershell.exe"], ["-NoProfile", "-Command", "exit 0"]);
  if (!powershell) fail("neither pwsh nor powershell.exe was found on PATH");
  command = powershell;
  args = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(scriptDir, "dev.ps1"), ...psArgs];
} else {
  if (!firstAvailable(["bash"], ["-c", "exit 0"])) fail("bash was not found on PATH");
  command = "bash";
  args = [path.join(scriptDir, "dev.sh"), ...shArgs];
}

const result = spawnSync(command, args, { stdio: "inherit", cwd: root });
if (result.error) fail(result.error.message);
process.exit(result.status ?? 1);
