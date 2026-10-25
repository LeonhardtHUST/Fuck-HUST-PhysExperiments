#!/usr/bin/env node
/**
 * Local launcher for the PhysLab MCP server (stdio transport).
 *
 * MCP is a *local* integration: nothing in dev/prod starts it, it never listens
 * on a port, and it is not part of the deploy image (refer to docs/mcp.md).
 *
 *   npm run mcp             serve on stdio (Ctrl+C stops it)
 *   npm run mcp:check       print the tool manifest to stderr and exit
 *   npm run mcp -- --check  same as above, extra args are forwarded verbatim
 *
 * AI clients spawn `backend/mcp_server.py` themselves; this wrapper exists for
 * humans who want to self-check or poke at the server without typing paths.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, "..");
const entry = path.join(root, "backend", "mcp_server.py");

function fail(message, code = 2) {
  console.error(`error: ${message}`);
  process.exit(code);
}

const CANDIDATES = [
  process.env.PHYSICSLAB_PYTHON,
  path.join(root, ".venv", "Scripts", "python.exe"),
  path.join(root, ".venv", "bin", "python"),
].filter(Boolean);

function findPython() {
  for (const candidate of CANDIDATES) {
    if (fs.existsSync(candidate)) return candidate;
  }
  const names = process.platform === "win32" ? ["python", "python3"] : ["python3", "python"];
  for (const name of names) {
    if (!spawnSync(name, ["--version"], { stdio: "ignore" }).error) return name;
  }
  return null;
}

const interpreter = findPython();
if (!interpreter) {
  fail("python was not found — create .venv first (refer to README, 一键脚本)");
}

const hasMcp = spawnSync(interpreter, ["-c", "import mcp"], { stdio: "ignore" });
if (hasMcp.status !== 0) {
  fail(`'mcp' is not installed for ${interpreter} — run: cd backend && pip install -r requirements.txt`);
}

if (!fs.existsSync(entry)) fail(`missing ${entry}`);

const args = [entry, ...process.argv.slice(2)];
if (!args.includes("--check") && !args.includes("--list-tools")) {
  console.error("physlab-mcp: serving on stdio (logs on stderr), press Ctrl+C to stop");
}

const result = spawnSync(interpreter, args, { stdio: "inherit", cwd: root });
if (result.error) fail(result.error.message);
process.exit(result.status ?? 1);
