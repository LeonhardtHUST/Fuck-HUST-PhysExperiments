/**
 * vinext 读取本文件以获得 Next 兼容的配置语义。
 *
 * - `output: "export"`：纯静态导出（产物目录由 vite.config.ts 的 build.outDir 指向 frontend/out）
 * - `trailingSlash: true`：已上线的深链形如 /experiments/<id>/workspace/，保持目录式产物
 * - `basePath`：GitHub Pages 需要 /<repo> 前缀（NEXT_PUBLIC_BASE_PATH 由 CI 注入）
 *
 * 已删除的两项：
 * - `turbopack.root`：vinext 不使用 Turbopack；跨目录 JSON 由 vite.config.ts 的
 *   `server.fs.allow` 负责。
 * - `assetPrefix`：与 `basePath` 取同一个值时会让资源被写成 `<prefix>/_next/...`，
 *   等于重复前缀；统一交给 `basePath` 处理。
 */
const nextConfig = {
  output: "export",
  trailingSlash: true,
  basePath: process.env.NEXT_PUBLIC_BASE_PATH || "",
};

export default nextConfig;
