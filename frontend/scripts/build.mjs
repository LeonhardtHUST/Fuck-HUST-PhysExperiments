/**
 * 前端构建入口（`npm run build`）。
 *
 * 包一层的原因只有一个：vinext 在 `basePath` 非空时会把静态导出嵌进
 * `out/<basePath>/`（沿用 Next 的 assetPrefix 语义）。而 GitHub Pages 的
 * artifact 根就是站点根（`/<repo>/`），嵌套一层会让所有页面变成
 * `/<repo>/<repo>/...`。这里把嵌套层拆平，让磁盘布局恒为：
 *
 *   out/index.html
 *   out/_next/static/**
 *   out/404.html
 *
 * HTML 里的资源 URL 仍然带 `/<repo>/` 前缀（由 vinext 生成），所以保持正确。
 * 未设置 `NEXT_PUBLIC_BASE_PATH` 时（本地、Oracle、CloudBase）本脚本只做构建。
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const outDir = path.join(root, "out");

const run = spawnSync("vinext", ["build"], {
  cwd: root,
  stdio: "inherit",
  shell: process.platform === "win32",
  env: process.env,
});

if (run.status !== 0) {
  process.exit(run.status ?? 1);
}

const prefix = (process.env.NEXT_PUBLIC_BASE_PATH ?? "").replace(/^\/+|\/+$/g, "");
if (!prefix) {
  process.exit(0);
}

const nested = path.join(outDir, prefix);
if (!fs.existsSync(path.join(nested, "index.html"))) {
  console.warn(`[build] expected ${path.relative(root, nested)}/index.html, nothing to flatten`);
  process.exit(0);
}

for (const entry of fs.readdirSync(nested)) {
  const target = path.join(outDir, entry);
  if (fs.existsSync(target)) {
    throw new Error(`[build] refusing to overwrite ${path.relative(root, target)} while flattening`);
  }
  fs.renameSync(path.join(nested, entry), target);
}
fs.rmdirSync(nested);

if (!fs.existsSync(path.join(outDir, "index.html"))) {
  throw new Error("[build] out/index.html missing after flattening basePath");
}
