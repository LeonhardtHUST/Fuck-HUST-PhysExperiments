#!/usr/bin/env node
/**
 * One-click deployment to CloudBase: Cloud Run container + static hosting.
 *
 * The frontend is a Next.js static export and its API address is baked in at
 * build time, so the order is fixed: deploy the container, read its public
 * URL, build with NEXT_PUBLIC_API_URL, then upload frontend/out.
 *
 *   npm run deploy                        full pipeline
 *   npm run deploy:backend                container only
 *   npm run deploy:frontend               build + upload only
 *   node scripts/deploy.mjs --dry-run     print the tcb commands, change nothing
 *
 * Every command and its output is appended to .dev-logs/cloudbase-<time>.log
 * (git-ignored); the resolved API address is cached in .dev-logs/cloudbase.json
 * so a failed frontend step can be retried without rebuilding the container.
 *
 * See `node scripts/deploy.mjs --help` for the flag list, and README
 * "部署到 CloudBase" for the login/CORS steps that cannot be automated.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, "..");
const isWindows = process.platform === "win32";

const DEFAULT_SERVICE = "physicslab-api";
const DEFAULT_PORT = 8001;
const DEFAULT_STATIC_PATH = "/";

const VALUE_FLAGS = new Map([
  ["--env", "envId"], ["-e", "envId"],
  ["--service", "service"], ["-s", "service"],
  ["--port", "port"],
  ["--api-url", "apiUrl"],
  ["--site-origin", "siteOrigin"],
  ["--path", "staticPath"],
  ["--env-params", "envParams"],
]);

const BOOLEAN_FLAGS = new Map([
  ["--skip-backend", "skipBackend"],
  ["--skip-frontend", "skipFrontend"],
  ["--skip-build", "skipBuild"],
  ["--dry-run", "dryRun"],
  ["--help", "help"], ["-h", "help"],
]);

const TASKS = new Set(["all", "backend", "frontend"]);

class DeployError extends Error {
  constructor(stage, message, hint) {
    super(message);
    this.stage = stage;
    this.hint = hint;
  }
}

function fail(message, hint) {
  console.error(`error: ${message}`);
  if (hint) console.error(`hint: ${hint}`);
  process.exit(2);
}

function printHelp() {
  console.log(`usage: npm run deploy [-- <task> <flags>]

tasks:
  all       backend container, then frontend build + upload (default)
  backend   only deploy the Cloud Run service
  frontend  only build and upload the static site

flags:
  -e, --env <envId>         overrides TCB_ENV_ID and cloudbaserc.json
  -s, --service <name>      Cloud Run service name (${DEFAULT_SERVICE})
      --port <port>         container port (${DEFAULT_PORT})
      --api-url <url>       reuse an existing API address, skip the container
      --site-origin <url>   CORS origin, written to deploy/cloudbase.env.json on first run
      --path <path>         static hosting mount path (${DEFAULT_STATIC_PATH})
      --env-params <json>   inline Cloud Run env vars
      --skip-backend        do not deploy the container
      --skip-frontend       do not build or upload the site
      --skip-build          upload frontend/out without rebuilding
      --dry-run             print commands only
  -h, --help                show this help

env:
  TCB_ENV_ID        target environment when neither --env nor cloudbaserc.json is set`);
}

function parseArgs(argv) {
  const options = {
    task: "all",
    envId: null,
    service: DEFAULT_SERVICE,
    port: String(DEFAULT_PORT),
    apiUrl: null,
    siteOrigin: null,
    staticPath: DEFAULT_STATIC_PATH,
    envParams: null,
    skipBackend: false,
    skipFrontend: false,
    skipBuild: false,
    dryRun: false,
    help: false,
  };

  let taskSeen = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (BOOLEAN_FLAGS.has(arg)) {
      options[BOOLEAN_FLAGS.get(arg)] = true;
      continue;
    }

    const valueKey = VALUE_FLAGS.get(arg);
    if (valueKey) {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith("-")) fail(`missing value for '${arg}'`);
      options[valueKey] = value;
      i += 1;
      continue;
    }

    if (arg.startsWith("-")) fail(`unknown flag '${arg}' (see node scripts/deploy.mjs --help)`);
    if (taskSeen) fail(`unexpected argument '${arg}' (only one task is allowed)`);
    if (!TASKS.has(arg)) fail(`unknown task '${arg}' (expected one of: all, backend, frontend)`);
    options.task = arg;
    taskSeen = true;
  }

  const port = Number(options.port);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) fail(`invalid --port '${options.port}'`);
  if (!options.staticPath.startsWith("/")) fail("--path must start with '/'");

  return options;
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function resolveEnvId(options) {
  if (options.envId) return options.envId;
  if (process.env.TCB_ENV_ID) return process.env.TCB_ENV_ID;

  const rc = readJsonFile(path.join(root, "cloudbaserc.json"));
  if (rc && typeof rc.envId === "string" && rc.envId.trim()) return rc.envId.trim();

  throw new DeployError(
    "preflight",
    "no CloudBase environment id",
    "pass --env <envId>, set TCB_ENV_ID, or add an envId to cloudbaserc.json"
  );
}

function locateTcb() {
  // npm is a .cmd on Windows, so it needs cmd.exe; passing a fixed command
  // string keeps this free of shell-quoting issues (and of DEP0190).
  const npmBin = isWindows ? process.env.ComSpec || "cmd.exe" : "npm";
  const npmArgs = isWindows ? ["/d", "/s", "/c", "npm root -g"] : ["root", "-g"];
  const probe = spawnSync(npmBin, npmArgs, { encoding: "utf8" });
  const globalRoot = (probe.stdout || "").trim();
  if (!globalRoot) return null;

  const cliEntry = path.join(globalRoot, "@cloudbase", "cli", "bin", "tcb");
  if (!fs.existsSync(cliEntry)) return null;

  // Running the CLI entry with node keeps arguments verbatim: JSON values such
  // as --env-params never pass through cmd.exe quoting rules.
  return { bin: process.execPath, prefix: [cliEntry] };
}

const tcb = locateTcb();
let dryRun = false;
let logStream = null;

function logLine(line) {
  if (!logStream) return;
  try {
    logStream.write(`${line}\n`);
  } catch {
    /* logging must never break the deployment */
  }
}

function openLog() {
  const dir = path.join(root, ".dev-logs");
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  logStream = fs.createWriteStream(path.join(dir, `cloudbase-${stamp}.log`), { flags: "a" });
}

function quoteForDisplay(value) {
  if (!/[\s"']/.test(value)) return value;
  return `"${value.replace(/"/g, '\\"')}"`;
}

function tail(text, lines = 20) {
  const all = text.trim().split(/\r?\n/);
  return all.slice(-lines).join("\n");
}

function runTcb(args, { capture = false, stage = "apply", cwd = root } = {}) {
  const printable = `tcb ${args.map(quoteForDisplay).join(" ")}`;

  if (dryRun) {
    console.log(`[dry-run] ${printable}`);
    return { code: 0, stdout: "", stderr: "", dryRun: true };
  }

  console.log(`\n$ ${printable}`);
  logLine(`\n$ ${printable}`);

  const result = spawnSync(tcb.bin, [...tcb.prefix, ...args], {
    cwd,
    encoding: "utf8",
    env: process.env,
  });

  if (result.error) {
    throw new DeployError(stage, `failed to start tcb: ${result.error.message}`, "npm i -g @cloudbase/cli");
  }

  const stdout = result.stdout || "";
  const stderr = result.stderr || "";
  logLine(stdout);
  logLine(stderr);

  if (result.status !== 0) {
    const combined = `${stdout}\n${stderr}`;
    throw new DeployError(
      stage,
      `tcb exited with code ${result.status}\n${tail(combined)}`,
      explainFailure(stage, combined)
    );
  }

  if (!capture && stdout.trim()) console.log(tail(stdout, 6));

  return { code: result.status, stdout, stderr };
}

function explainFailure(stage, text) {
  if (/not login|未登录|please login|credential|invalid secret/i.test(text)) {
    return "run `tcb login` first, and make sure the account belongs to the same site as this environment";
  }
  if (
    stage === "backend" &&
    /套餐|体验版|quota|limit|forbidden|permission|not support|不支持|未开通|开通|ResourceNotFound|not activated/i.test(text)
  ) {
    return (
      "Cloud Run is not enabled for this environment (the trial edition does not include it). " +
      "Enable 云托管 in the CloudBase console, or retry with --skip-backend --api-url <existing API> to publish the site only"
    );
  }
  if (stage === "preflight") {
    return "check `tcb env list`, `tcb config set isIntl true`, and that the env id is correct";
  }
  return null;
}

function parseJsonLoose(text) {
  const trimmed = (text || "").trim();
  if (!trimmed) return null;

  try {
    return JSON.parse(trimmed);
  } catch {
    /* fall through to per-line and slice parsing */
  }

  const lines = trimmed.split(/\r?\n/);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i].trim();
    if (!line.startsWith("{") && !line.startsWith("[")) continue;
    try {
      return JSON.parse(line);
    } catch {
      /* keep scanning */
    }
  }

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      /* ignore */
    }
  }

  return null;
}

function findPublicUrl(value, depth = 0) {
  if (depth > 8 || value === null || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findPublicUrl(item, depth + 1);
      if (found) return found;
    }
    return null;
  }

  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === "string" && /^https?:\/\//i.test(entry) && /url|domain|endpoint|host/i.test(key)) {
      return entry.replace(/\/+$/, "");
    }
  }

  for (const entry of Object.values(value)) {
    const found = findPublicUrl(entry, depth + 1);
    if (found) return found;
  }

  return null;
}

function resolveEnvParams(options) {
  if (options.envParams) {
    const parsed = parseJsonLoose(options.envParams);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      fail('--env-params must be a JSON object, e.g. --env-params \'{"CORS_ORIGINS":"https://example.com"}\'');
    }
    return { params: parsed, source: "--env-params" };
  }

  const file = path.join(root, "deploy", "cloudbase.env.json");
  const stored = readJsonFile(file);
  if (stored && typeof stored === "object" && !Array.isArray(stored)) {
    return { params: stored, source: "deploy/cloudbase.env.json" };
  }

  if (options.siteOrigin) {
    const params = { CORS_ORIGINS: options.siteOrigin };
    if (!dryRun) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, `${JSON.stringify(params, null, 2)}\n`, "utf8");
    }
    return { params, source: "--site-origin (written to deploy/cloudbase.env.json)" };
  }

  return { params: {}, source: "none (empty object)" };
}

function ensureEnvVisible(envId) {
  const result = runTcb(["env", "list"], { capture: true, stage: "preflight" });
  if (!result.dryRun && !result.stdout.includes(envId)) {
    throw new DeployError(
      "preflight",
      `environment ${envId} is not visible from this account`,
      "check `tcb login` and `tcb config set isIntl true` (a site mismatch hides environments)"
    );
  }
}

function deployBackend({ envId, service, port, params }) {
  const args = [
    "cloudrun", "deploy",
    "-e", envId,
    "-s", service,
    "--source", "backend",
    "--port", port,
    "--env-params", JSON.stringify(params),
    "--wait",
    "--force",
    "--json",
  ];

  const result = runTcb(args, { capture: true, stage: "backend" });
  if (result.dryRun) return null;

  const payload = parseJsonLoose(result.stdout);
  const url = payload ? findPublicUrl(payload) : null;
  if (!url) {
    throw new DeployError(
      "backend",
      "container deployed but its public URL was not found in the CLI output",
      `open the console for ${envId}, copy the service URL, then run: npm run deploy:frontend -- --api-url <url>`
    );
  }

  return url;
}

function buildFrontend(apiUrl) {
  const command = `node scripts/dev.mjs build  (NEXT_PUBLIC_API_URL=${apiUrl}, NEXT_PUBLIC_BASE_PATH=)`;
  if (dryRun) {
    console.log(`[dry-run] ${command}`);
    return;
  }

  console.log(`\n[build] ${command}`);
  logLine(`\n[build] ${command}`);

  const result = spawnSync(process.execPath, [path.join(scriptDir, "dev.mjs"), "build"], {
    cwd: root,
    stdio: "inherit",
    env: {
      ...process.env,
      NEXT_PUBLIC_API_URL: apiUrl,
      // Static hosting serves the site from the domain root, so the GitHub
      // Pages basePath must not leak into the bundle.
      NEXT_PUBLIC_BASE_PATH: "",
    },
  });

  if (result.error) {
    throw new DeployError("frontend", `failed to start the build: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new DeployError(
      "frontend",
      `frontend build exited with code ${result.status}`,
      "do not delete .next or frontend/out mid-build; see README 本地运行 for the build notes"
    );
  }

  const indexFile = path.join(root, "frontend", "out", "index.html");
  if (!fs.existsSync(indexFile)) {
    throw new DeployError(
      "frontend",
      "frontend/out/index.html is missing after the build",
      "rerun `npm run build` on its own to see the full error; the upload needs frontend/out"
    );
  }
}

function uploadFrontend(envId, staticPath) {
  runTcb(["hosting", "deploy", "frontend/out", staticPath, "-e", envId], {
    capture: true,
    stage: "frontend",
  });
}

function writeCache(patch) {
  if (dryRun) return;
  const file = path.join(root, ".dev-logs", "cloudbase.json");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const merged = { ...(readJsonFile(file) || {}), ...patch, updatedAt: new Date().toISOString() };
  fs.writeFileSync(file, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
}

function printSummary({ envId, service, apiUrl, staticPath }) {
  console.log("\n=== deployment summary ===");
  console.log(`environment : ${envId}`);
  console.log(`api service : ${service}${apiUrl ? `  ->  ${apiUrl}` : ""}`);
  console.log(`static path : ${staticPath}`);
  console.log("console     : open CloudBase -> 静态托管 to copy the site domain");
  console.log("");
  console.log("CORS        : the site origin must be in deploy/cloudbase.env.json (CORS_ORIGINS).");
  console.log("              On the first deploy the domain does not exist yet: copy it from the");
  console.log("              console, add it to the file, then run `npm run deploy:backend` again.");
  if (dryRun) console.log("\n(dry run: nothing was uploaded)");
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  dryRun = options.dryRun;
  const envId = resolveEnvId(options);

  if (!tcb) {
    if (dryRun) {
      console.warn("warning: CloudBase CLI not found; commands are printed only");
    } else {
      fail("CloudBase CLI not found", "npm i -g @cloudbase/cli");
    }
  }

  openLog();
  logLine(`# deploy ${new Date().toISOString()} task=${options.task} env=${envId}`);

  const [major, minor] = process.versions.node.split(".").map(Number);
  if (major < 20 || (major === 20 && minor < 9)) {
    console.warn(`warning: node ${process.versions.node} is older than the supported >=20.9`);
  }

  console.log(`environment : ${envId}`);

  const runBackend = options.task !== "frontend" && !options.skipBackend;
  const runFrontend = options.task !== "backend" && !options.skipFrontend;

  if (!dryRun) ensureEnvVisible(envId);

  const cache = readJsonFile(path.join(root, ".dev-logs", "cloudbase.json")) || {};
  let apiUrl = options.apiUrl || cache.apiUrl || null;

  if (runBackend) {
    const { params, source } = resolveEnvParams(options);
    console.log(`cloud run env: ${source}`);
    const deployedUrl = deployBackend({
      envId,
      service: options.service,
      port: options.port,
      params,
    });
    if (deployedUrl) {
      apiUrl = deployedUrl;
      writeCache({ envId, service: options.service, apiUrl });
    }
  }

  if (runFrontend) {
    if (!apiUrl && !dryRun) {
      throw new DeployError(
        "frontend",
        "no API address to bake into the frontend bundle",
        "deploy the backend first (`npm run deploy:backend`), or pass --api-url <url>"
      );
    }

    buildFrontend(apiUrl || "https://<api-url>");
    uploadFrontend(envId, options.staticPath);
  }

  printSummary({
    envId,
    service: options.service,
    apiUrl,
    staticPath: options.staticPath,
  });
}

try {
  main();
} catch (error) {
  if (error instanceof DeployError) {
    console.error(`\n[${error.stage}] ${error.message}`);
    if (error.hint) console.error(`hint: ${error.hint}`);
  } else {
    console.error(`\n[unexpected] ${error && error.stack ? error.stack : error}`);
  }
  process.exitCode = 1;
} finally {
  if (logStream) logStream.end();
}
