import path from "node:path";
import { fileURLToPath } from "node:url";

import vinext from "vinext";
import { defineConfig, lazyPlugins } from "vite-plus";

const root = path.dirname(fileURLToPath(import.meta.url));

/**
 * `NEXT_PUBLIC_*` 在构建期内联（与 Next 时代的语义保持一致）。
 * 未设置的变量必须显式定义成字面量 `undefined`：vinext 只为「已存在」的变量生成
 * define 条目，缺省时浏览器端会残留裸 `process.env.X`，在模块顶层直接 ReferenceError。
 * `src/lib/api.ts` 用 `??` 而非 `||`，空串代表同源，语义不能丢。
 */
const publicEnv = (name: string) => ({
  [`process.env.${name}`]:
    process.env[name] === undefined ? "undefined" : JSON.stringify(process.env[name]),
});

export default defineConfig({
  // 格式检查暂不纳入准入：仓库此前没有 formatter，全量 oxfmt 会改动 59 个文件，
  // 留给独立的 chore commit。需要时 `vp fmt` 手动跑，`vp check --no-fmt` 是日常入口。
  fmt: { ignorePatterns: ["out/**", "dist/**", "package-lock.json"] },
  lint: {
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: { "vite-plus/prefer-vite-plus-imports": "error" },
    options: { typeAware: true, typeCheck: true },
    ignorePatterns: ["out/**", "dist/**", ".vinext/**"],
  },
  // 单测是纯 Node 逻辑（含读源码做断言的用例），不需要 DOM 环境。
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
  plugins: lazyPlugins(() => [
    vinext({
      // 产物契约：四条托管通道（serve-static / GitHub Pages / Oracle nginx /
      // CloudBase）全部消费 frontend/out，目录名不能变。vinext 的默认值是
      // dist/client，`build.outDir` 管不到它，只有这个选项能改。
      clientOutDir: "out",
    }),
  ]),
  resolve: {
    alias: { "@": path.resolve(root, "src") },
  },
  server: {
    port: 3000,
    strictPort: true,
    // 客户端直接 import ../../../backend/experiments/*.json（实验配置单一事实源），
    // dev server 默认只允许工作区根内的文件，必须把仓库根放行。
    fs: { allow: [root, path.resolve(root, "..")] },
  },
  define: {
    ...publicEnv("NEXT_PUBLIC_API_URL"),
    ...publicEnv("NEXT_PUBLIC_PHYSICSLAB_DEV_MODE"),
  },
});
