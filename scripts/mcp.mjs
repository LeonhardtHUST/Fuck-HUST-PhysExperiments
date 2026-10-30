#!/usr/bin/env node
/**
 * Local launcher for the MCP server (stdio transport).
 *
 * MCP is a *local* integration: nothing in dev/prod starts it, it never listens
 * on a port, and it is not part of the deploy image (refer to docs/mcp.md).
 *
 *   npm run mcp               serve on stdio (Ctrl+C stops it)
 *   npm run mcp:check         print the tool manifest to stderr and exit
 *   npm run mcp:config        print paste-ready client configs for this machine
 *   npm run mcp -- --check    same as mcp:check, extra args are forwarded verbatim
 *
 * AI clients spawn `backend/mcp_server.py` themselves and cannot resolve
 * repo-relative paths (their working directory is arbitrary), so the config
 * they need always contains this machine's absolute paths. `mcp:config`
 * generates those paths instead of shipping someone else's in the docs.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, "..");
const entry = path.join(root, "backend", "mcp_server.py");

const argv = process.argv.slice(2);
const configOnly = argv.includes("--print-config");

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

const hasMcp = spawnSync(interpreter, ["-c", "import mcp"], { stdio: "ignore" }).status === 0;
if (!hasMcp) {
  const hint = `'mcp' is not installed for ${interpreter} — run: cd backend && pip install -r requirements.txt`;
  // `mcp:config` is also useful before dependencies are installed, so only warn there.
  if (configOnly) console.error(`warning: ${hint}`);
  else fail(hint);
}

if (!fs.existsSync(entry)) fail(`missing ${entry}`);

/** Clients need an absolute command, so resolve a PATH hit through sys.executable. */
function absoluteInterpreter() {
  if (path.isAbsolute(interpreter)) return interpreter;
  const res = spawnSync(interpreter, ["-c", "import sys; print(sys.executable)"], {
    encoding: "utf8",
  });
  const resolved = (res.stdout ?? "").trim();
  return resolved || interpreter;
}

/** Forward slashes work in TOML and JSON on Windows, and need no escaping. */
function slashes(p) {
  return p.split(path.sep).join("/");
}

function printConfig() {
  const python = slashes(absoluteInterpreter());
  const server = slashes(entry);
  const platform = process.platform === "win32" ? "Windows" : process.platform;
  const lines = [
    `# 本机 MCP 配置（${platform}），由 npm run mcp:config 生成，路径已填好，可直接粘贴。`,
    "# 换机器或移动仓库后重新生成；不要把这些路径提交进仓库。",
    "",
    "## 1) codex — ~/.codex/config.toml",
    "",
    "[mcp_servers.physlab]",
    `command = "${python}"`,
    `args = ["${server}"]`,
    "startup_timeout_sec = 30",
    "",
    "## 2) opencode — opencode.json",
    "",
    "{",
    '  "$schema": "https://opencode.ai/config.json",',
    '  "mcp": {',
    '    "physlab": {',
    '      "type": "local",',
    '      "command": [',
    `        "${python}",`,
    `        "${server}"`,
    "      ],",
    '      "enabled": true',
    "    }",
    "  }",
    "}",
    "",
    "## 3) CodeBuddy / Claude Desktop — mcpServers",
    "",
    "{",
    '  "mcpServers": {',
    '    "physlab": {',
    '      "type": "stdio",',
    `      "command": "${python}",`,
    `      "args": ["${server}"],`,
    '      "description": "PhysExp Killer 大学物理实验数据处理"',
    "    }",
    "  }",
    "}",
    "",
  ];
  // stdout is free here: this mode exits before any stdio protocol frame is written.
  console.log(lines.join("\n"));
}

if (configOnly) {
  printConfig();
  process.exit(0);
}

const args = [entry, ...argv];
if (!args.includes("--check") && !args.includes("--list-tools")) {
  console.error("physlab-mcp: serving on stdio (logs on stderr), press Ctrl+C to stop");
}

const result = spawnSync(interpreter, args, { stdio: "inherit", cwd: root });
if (result.error) fail(result.error.message);
process.exit(result.status ?? 1);
