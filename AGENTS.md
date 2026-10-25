# AGENTS.md

本文件只记录 **README 之外**的协作约定。运行命令、项目架构、实验清单以 `README.md` 为唯一事实源：

- 项目架构、本地启动/构建/停止：**refer to `README.md`**（「项目架构」「本地运行（开发者）」）
- artifact 数据格式：`docs/artifact-format.md`
- 部署：`docs/deployment.md`

需要启动服务、构建产物或查脚本参数时，**refer to `README.md`**，不要凭记忆改写命令。`.codebuddy/` 是本地 IDE 元数据（已忽略），不属于仓库内容。

## 经验沉淀（每次任务结束都执行）

收尾时把这次新学到的东西写回本文件，别只留在会话里：

1. 先读 `README.md`：命令、参数、架构、脚本清单等已有内容**不要复述**，最多写一行 **refer to `README.md`** 并标注定位（章节名）。
2. 只沉淀可复用的判断：不变量、必须遵守的命令顺序、失败特征 → 病因 → 处置。
3. 追加到「踩坑记录」末尾并编号；同类问题合并改写既有条目，不新增重复条目。
4. 写到可照做的程度：给完整命令 / 文件路径，避免“上次那个脚本”这类指代。
5. 这类文档改动单独提交：`docs(agents): ...`，与功能改动分开。

## 验证矩阵

README 只覆盖启动与构建，下面的检查需自己执行：

| 范围 | 命令 |
| --- | --- |
| 前端类型 | `cd frontend && npx tsc --noEmit` |
| 前端单测 | `cd frontend && npm test`（`node --test` + TS type stripping） |
| 后端 | `cd backend && python -m pytest -q`（约 570 项；定位用 `-k` / `-m fast`） |
| 静态构建 | refer to `README.md`「一键脚本」（`npm run build`，产物 `frontend/out`） |
| 生产模式产物 | 启动方式 refer to `README.md`；起来后逐项请求 `/`、一个深链（`/experiments/<slug>/workspace/`）、`/_next/static/**` 的 css 与 js、一个不存在的路径（须 404）、`HEAD /`、`/health` |
| UI | 启动方式 refer to `README.md`；改动后必须截图核查，见「UI 改动要看得见」 |

## 不变量（改错代价最高）

### 实验配置是单一事实源

`backend/experiments/<slug>/config.json` 同时被后端和前端消费——`frontend/src/lib/experiment-specs.ts` 直接 `import` 这些 JSON 文件。改字段、方法 id、列定义会同时影响两端，构建期就会暴露不一致。

每个实验目录还必须有 `prompt_context.json`：`experimentId` 与 `config.json` 一致，`methods` 的 id 集合与适配器一致，公式非空。`backend/tests/test_prompt_context.py` 会守护这些约束，新增实验时别漏。

### OCR 标定与模板成对存在

- 标定布局：`backend/ocr_dataset/layouts/<slug>.json`
- 模板：`backend/ocr_layouts/<slug>.json`，由标定生成

```
cd backend
python -m ocr_dataset.calibrate --experiment <slug>            # 干跑，看差异
python -m ocr_dataset.calibrate --experiment <slug> --write    # 写回标定
python -m ocr_dataset.templates --write                        # 重建全部模板
python -m ocr_dataset.templates --check                        # 必须通过
```

改记录表渲染或版面后，两套文件必须一起更新；只改一边会导致 OCR 配准失败（`grid_mismatch`），样本数变 0。

### artifact 导入是“按表合并”，不是整体覆盖

- 文件里出现的表才更新；文件没提到的表、以及实验级备注（`remarks`）应保留，单表导入尤其不能顺手清空其他表。
- 合并逻辑集中在 `mergeArtifactNotes`（`frontend/src/lib/artifact-scope.ts`），改动导入语义时同步补 `frontend/tests/experiment-artifact.test.ts`。
- `schemaVersion` 必须为 `1`；`experiment.id` 必须与当前工作台一致，否则拒绝导入。

### 表格行数是动态的

数据表支持自由增删行，校验按配置里的最小行数放行（见提交 `19d8054`、`ead6561`）。不要在新代码里假设固定行数或按空行截断。

## 踩坑记录

### 1. OCR 样本测试失败≠代码 bug

`tests/test_ocr_builder.py::test_every_public_experiment_produces_samples` 失败，通常是某个实验的记录表改了排版而标定没跟上。做法：

1. 单跑该测试，从 `produced` 字典定位是哪个实验为 0；
2. 先干跑 `ocr_dataset.calibrate --experiment <slug>` 看坐标差异是否符合预期；
3. `--write` 标定，再 `templates --write`，最后 `templates --check`；
4. `git status` 确认只有目标实验的布局/模板变化，其余实验用 `git checkout --` 还原。

### 2. 生成 JSON 的换行会污染整份 diff

仓库统一用 LF。Python `Path.write_text` 在 Windows 上默认写 CRLF，重新生成模板后整份文件都会显示为改动。提交前看 `git diff --stat`：若增删行数恰好等于文件行数，就是换行问题，归一为 LF 再提交。

### 3. `next build` 可能卡在清理阶段

残留的 `.next` 缓存加上清理子进程被外部（如 IDE 的安全删除钩子）拖住时，构建会长时间无输出。不要在前台干等：

- 用后台进程把 stdout/stderr 重定向到日志文件，轮询日志与 `Test-Path frontend/out`；
- 确认卡住的是 next 的清理阶段后，停掉进程、移走 `.next` 再重跑；
- 构建残留（`.next`、`out`、日志）不要进入提交。

### 4. `next dev` 会改写 tracked 的 `next-env.d.ts`

`frontend/next-env.d.ts` 是受版本控制的文件，`next dev` 会重写它。跑完 dev 后用 `git checkout -- frontend/next-env.d.ts` 还原，别把它混进功能提交。

### 5. 失败先对照干净 HEAD

怀疑某个失败是本次改动引入时，用 `git worktree add --detach <临时目录>/physlab-head HEAD` 建一个干净副本跑同一条测试（用完 `git worktree remove` 清理）。既有漂移和本次回归要区分开，避免把无关修复塞进当前提交。

### 6. UI 改动要看得见

类型检查和单测通过不代表界面正确。改动工作台后，起服务用 Playwright 截图或量测：工具条对齐、弹窗、备注卡片、导入确认、AI 参考值这些都要实际看一眼。临时脚本用完删除，不要留在仓库里。

### 7. 常驻服务绝不能在前台跑

`npm run dev` / `npm run prod` 按设计**独占当前控制台**，直到 `Ctrl+C` 或 `npm run stop`（命令与参数 refer to `README.md`「本地运行（开发者）」）。在代理会话里前台执行只有两种结局：等到超时，或超时被杀并连带打断正在跑的构建。

- 一律 `npm run dev|prod -- --detach --no-browser`，收尾 `npm run stop`；
- 也不要在单条命令里长时间 `Start-Sleep` 轮询：先 detach 启动，再用另一条短命令查状态，保持会话可响应；
- 停完必须复查：`listeners=0`（`Get-NetTCPConnection -LocalPort 8001,3000 -State Listen`），且没有残留 `dev.mjs` / `dev.ps1` / `uvicorn` / `serve-static` 进程；
- 按端口停不掉父进程时整棵树杀：`taskkill /PID <pid> /T /F`（Windows）、`pkill -P <pid>`（bash）。只杀监听进程会留下 `npm`/`dev.mjs` 空壳。

### 8. 构建必须串行，锁文件删了也没用

`next build` 用 `frontend/.next/lock` 做**操作系统级独占锁**（不是“文件存在即占用”）。并发两个构建会互相删 `out`、重写 `.next`，症状：`Another next build process is already running`、静态站点整片 404、构建时间从 ~1 分钟涨到十几分钟。

- 同一时刻只允许一个构建，别“边等边再发一条”；
- 报上述错误时先确认没有残留进程：
  `Get-CimInstance Win32_Process -Filter "Name='node.exe'" | ? { $_.CommandLine -match 'next' }`，`taskkill /PID <pid> /T /F` 后锁由操作系统释放，**删锁文件无效**；
- 被强杀后 `frontend/out` 可能是空的或缺失，属正常，重跑一次构建即可，不要手工拼产物。

### 9. 构建脚本自己清理导出目录

`next build` 用 `fs.rm` 删 `frontend/out`，在 Windows 上会被 IDE 的安全删除钩子拦掉并报 ENOENT。清理已由 `scripts/dev.ps1` / `scripts/dev.sh` 负责（实现细节见脚本内注释，用法 refer to `README.md`）：**不要在半路手动删 `.next` / `out` 后中断构建**，那只会制造“锁被占”和 404 的假象。

### 10. MCP stdio 自测：stdout 只有协议帧，收尾别靠官方客户端

- **现象**：临时脚本用 `mcp.client.stdio.stdio_client` 起 `backend/mcp_server.py` 会卡住不返回，并留下孤儿 `python.exe`（脚本与 server 各一个），看起来像「服务端不应答」；实际 `initialize` / `tools/list` 早已正常返回（单帧耗时 ~2 s）。
- **病因一（收尾）**：官方客户端的子进程收尾在 Windows 上会挂住，与业务代码无关。
- **病因二（探针写法）**：`subprocess.run(input=整段 JSON-RPC)` 写完立刻 EOF，服务器处理完前几帧就退出，后面的 `tools/call` 拿不到响应；必须用 `Popen` 保持 stdin 开启，按行读 stdout 并给每帧设超时，最后 `kill`。
- **正确自测**：`npm run mcp:check`（`scripts/mcp.mjs` 转发到 `backend/mcp_server.py --check`，清单打到 stderr）；协议层回归不必起客户端，`backend/tests/test_mcp_tools.py` 直接调纯函数。
- **MCP 只在本机**：`backend/Dockerfile` 不 COPY `mcp_server.py` / `physlab_mcp/`，`backend/.dockerignore` 也把两者排除，云端只跑 `uvicorn`。别为了「容器里也能跑」把 COPY 加回去——部署产物里出现 MCP 即视为回退（见 `docs/deployment.md`「MCP 不在部署范围内」）。
- **清孤儿**：`Get-CimInstance Win32_Process -Filter "Name='python.exe'" | ? { $_.CommandLine -match 'mcp_server|probe' }` 后逐个 `taskkill /PID <pid> /T /F`（PowerShell 里 `$pid` 是只读内置变量，循环变量换个名字）。
- **纪律**：stdio 下日志一律走 stderr，入口脚本已强制 `MPLBACKEND=Agg`（否则 matplotlib 可能弹窗/写 stdout 破坏协议）。

## 提交习惯

- 提交信息用中文 Conventional Commits，scope 取模块名：`feat(workspace): ...`、`fix(gmr): ...`、`docs(readme): ...`。
- 提交前 `git status` 自查：不提交 `.next`、`.next.bak`、`out`、`frontend/.next/lock`、构建日志、临时脚本（`scripts/_tmp_*`、`backend/_tmp_*.py`）。
- 一次提交聚焦一个主题；跨端改动（config + 前端 spec + 测试）放同一次提交，保证任一提交点都可构建。
