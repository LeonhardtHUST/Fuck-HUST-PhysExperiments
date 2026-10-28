# 发布说明

当前公开测试版本为 `2.0.0-beta.1`。测试站必须保留全局 Beta 提示，不应将合成 fixture 测试描述为真实实验验证。发布后需要依次检查健康端点、实验目录、数据计算、OCR 人工确认和 PDF 报告下载。

## GitHub Pages

仓库中的 Pages 工作流只发布 `frontend/` 的 vinext 静态导出。仓库设置中需要将 Pages 的 Source 设为 **GitHub Actions**。

实验计算和 Word/PDF 报告生成仍由 FastAPI 后端完成。后端应部署到独立的 HTTPS 地址，并在仓库的 Actions variable 中设置：

```text
NEXT_PUBLIC_API_URL=https://你的后端域名
```

如果不配置后端地址，Pages 上只能浏览静态页面和仓库内已有的静态资源，不能提交数据、计算或下载动态报告。

## Oracle Always Free（推荐的零月费方案）

项目提供 `deploy/oracle/` 的同源 Docker Compose 部署方案，适用于 Oracle Cloud Always Free VM：

- `backend` 运行 FastAPI、NumPy、SciPy、Matplotlib 和报告生成依赖；
- `frontend` 构建 vinext 静态页面，由 Nginx 提供并反向代理 `/api/`；
- 两个容器均配置 `restart: unless-stopped`，后端不因空闲进入冷启动；
- 详细准备、VCN 放行和部署命令见 `deploy/oracle/README.md`。

该方案使用同源 API，前端生产构建时 `NEXT_PUBLIC_API_URL` 为空；本地开发仍使用 `.env.local` 指向 `http://localhost:8001`。

## Cloudflare Pages + Containers

本项目已经提供 Cloudflare Container Worker 配置：

- `backend/Dockerfile`：打包 FastAPI、NumPy、SciPy、Matplotlib 和报告生成依赖。
- `cloudflare/wrangler.jsonc`：声明 Container、Durable Object 绑定和镜像路径。
- `cloudflare/src/index.ts`：将 API 请求转发到容器的 8001 端口。

在仓库根目录安装 Wrangler 并部署后端：

```bash
npm install --prefix cloudflare
npm run --prefix cloudflare deploy
```

Cloudflare Containers 需要 Workers Paid 计划。部署前，如果使用自定义 Pages 域名，请把 `cloudflare/wrangler.jsonc` 中的 `image_vars.CORS_ORIGINS` 改为实际 Pages 源；默认值已配置为本项目的 GitHub Pages 地址。部署后，将 `https://<你的-worker>.workers.dev` 作为 Cloudflare Pages 的 `NEXT_PUBLIC_API_URL`。Cloudflare Pages 的构建根目录设为 `frontend`，构建命令为 `npm ci && npm run build`，输出目录为 `out`；Cloudflare Pages 上应将 `NEXT_PUBLIC_BASE_PATH` 留空。

部署后先检查 `https://<你的-worker>.workers.dev/health`，再从 Pages 页面验证 `/api/experiments`、数据处理和报告下载。

PhysKiller 2.0 的匿名分析和 OCR 反馈默认写入容器临时目录中的 SQLite。若需要在自托管后端保留统计，应通过环境变量 `PHYSICSLAB_TELEMETRY_DB` 指向持久卷；不要把该数据库提交到 Git。默认 OCR provider 是 RapidOCR，只有在镜像额外安装 PaddleOCR 后才设置 `PHYSICSLAB_OCR_PROVIDER=paddleocr`。

## CloudBase（静态托管 + 云托管）

仓库根目录的 `cloudbaserc.json` 指定目标环境，`npm run deploy` 把两件事串成一条流水：

- `tcb cloudrun deploy --source backend`：按 `backend/Dockerfile` 在云端构建 FastAPI 容器（端口 8001），服务不存在时自动创建；
- `tcb hosting deploy frontend/out /`：把 vinext 静态导出上传到静态托管。

因为前端在构建期把 `NEXT_PUBLIC_API_URL` 编译进产物，脚本顺序固定为「容器 → 解析公网地址 → 构建前端 → 上传」，并把解析到的地址缓存到 `.dev-logs/cloudbase.json`，让 `deploy:frontend` 可以单独重跑。

准备工作：

```bash
npm i -g @cloudbase/cli
tcb login
tcb config set isIntl true   # 环境属于腾讯云国际站时需要
tcb env list                 # 确认能看到 cloudbaserc.json 里的 envId
```

命令、参数与日志位置见 README「部署到 CloudBase」。三处容易踩：

1. **CORS 要回填**：`backend/app/main.py` 把 `CORS_ORIGINS` 追加到默认来源之后，默认只有 localhost 与 GitHub Pages。首次部署成功后，把静态托管域名写进 `deploy/cloudbase.env.json`（多个用逗号分隔），再执行 `npm run deploy:backend`。
2. **环境变量是全量覆盖**：`tcb cloudrun deploy --env-params` 会用传入 JSON 整体替换线上变量，所以脚本以 `deploy/cloudbase.env.json` 为唯一事实源；只在控制台改会被下一次部署覆盖。
3. **套餐限制**：云托管需要对应套餐支持。创建服务被拒时可用 `npm run deploy:frontend -- --api-url <已有后端地址>` 只发布站点，后端继续留在 Oracle 或 Cloudflare。

`--dry-run` 只打印将要执行的 `tcb` 命令，适合先核对 envId、服务名、端口与 CORS。完整日志写入 `.dev-logs/cloudbase-*.log`。

## MCP 不在部署范围内

`backend/mcp_server.py` 与 `backend/physlab_mcp/` 是**本地**能力，只供开发者机器上的 AI 客户端（codex / opencode / CodeBuddy 等）通过 stdio 接入，不参与上云：

- `backend/Dockerfile` 只打包 `app/`、`experiments/`、`record-sheets/`，镜像里没有 MCP 代码，也没有 MCP 启动命令；
- `backend/.dockerignore` 把 `mcp_server.py`、`physlab_mcp/` 排除在构建上下文之外，将来若有人加回 `COPY` 只会在构建时报错，不会把代码送上去；
- CloudBase / Oracle / Cloudflare 的部署配置都只启动 `uvicorn`，不为 MCP 开端口。

接入与自检方式见 `docs/mcp.md`（本机执行 `npm run mcp:check`）。

## 本地验证

```bash
cd frontend
npm ci
npm test          # vp test（Vitest）
npm run check     # Oxlint + 类型检查
npx tsc --noEmit
NEXT_PUBLIC_BASE_PATH=/physicslab npm run build
```

静态文件会输出到 `frontend/out/`（目录式产物：每个路由一个 `index.html` + `404.html`）。后端仍按根目录 README 中的 FastAPI 命令单独启动。

> 在 **Git Bash** 下直接写 `NEXT_PUBLIC_BASE_PATH=/physicslab npm run build` 会被 MSYS 把值改写成 `D:/Program Files/.../physicslab`（绝对路径），构建随即失败。要么用 PowerShell / cmd，要么用 `node -e "process.env.NEXT_PUBLIC_BASE_PATH='/physicslab'; …"` 注入，CI（Linux）不受影响。
