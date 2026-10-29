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
| 前端单测 | `cd frontend && npm test`（= `vp test`，Vitest 5；17 文件 / 110 用例） |
| 前端 lint + 类型 | `cd frontend && npm run check`（= `vp check --no-fmt`；格式检查未纳入准入） |
| 后端 | `cd backend && python -m pytest -q`（约 640 项；定位用 `-k` / `-m fast`） |
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

### 原始读数只搬运，派生量按规则修约

有效数字是实验数据的一部分：`1.20` 与 `1.2` 不是同一个精度，`0.000100` 与 `0.0001` 也不同。
链路分两半，谁都不许越界：

- **原始读数**：artifact / 读数 JSON 的数值列一律写字符串（`encodeCell`，见 `frontend/src/lib/experiment-artifact.ts`）；
  报告请求额外带原样字符串 `rows_raw` / `params_raw`（通用、声光）与每行 `raw`（偏振光），
  与数字字段来自**同一个 trim 后的数组**，禁止从数字反推字符串。
- **原始数据表**只读 raw：`documents.raw_cell` / `docbuild._cell` / `soundlight.docs._raw_col`；
  raw 缺失才回落到数字格式化，且回落时不做固定小数位重排。
- **派生量**统一走 `backend/experiments/core/precision.py` 的 `format_result`（规则表 + 全局键名 + 列继承）；
  适配器、引擎里**不要**再 `round()` 结果，否则就是双重修约。
- 新增结果键后跑 `cd backend && python -m experiments.core.precision --audit`，
  落到 `default:sig4` 的会被点名，需要显式补规则。
- `decimal_places` 已从 config 契约移除（`experiments/schema.py`）：不要恢复「建议保留不超过 N 位小数」，
  那会把学生真实的 4 位估读劝成 3 位。

### 表格行数是动态的

数据表支持自由增删行，校验按配置里的最小行数放行（见提交 `19d8054`、`ead6561`）。不要在新代码里假设固定行数或按空行截断。

### 实验数据只有「导入 / 导出」两个语义入口

`ArtifactActions.tsx` 是全站唯一的实验数据出入口，别再往工具条或页面上挂新按钮：

- 顶层只两个按钮：`导入数据 / 导出`（单表处为 `导入此表 / 导出此表`）。`导出` 打开的是三页签弹窗：`完整报告` → `纸质记录表` → `读数 JSON`（`ExportTab = "report" | "record" | "data"`），缺哪个页签就不出现，第一个可用页签即默认页。
  - 报告格式（Word / PDF / Markdown / JSONC）只允许出现在 `report` 页签；记录表（预览 / Word / PDF）只允许出现在 `record` 页签。**不要**在页面横幅、页头或结果卡里再摊开这七个按钮——历史上三组导出按钮分散在三处，用户找不到匿名分享入口。
  - 页面内的 CTA（如「生成完整报告」）通过 `ArtifactActionsHandle`（`useImperativeHandle`，ref 暴露 `openExport(tab?) / openImport()`）打开同一个弹窗，不要在页面上再实现一份下载逻辑。
  - 回调由工作台传入：`report={{ download, disabled, disabledHint, collection }}`、`recordSheet={{ preview, download }}`；忙碌态与错误显示在弹窗内（`pending` / `error`），下载仍走工作台自己的 `act` / `runDownload`，于是 busy 幂等只保留一份。
- 导入弹窗内的页签顺序固定：`拍照录入` → `粘贴 / 文件` → `AI Prompt` → `Schema` → `导入备注`；OCR 页签只在传了 `ocrTargets` 时出现，备注页签只在当前 scope 有备注时出现。
- 拍照录入不再有表格上方的常驻面板（`DataInputTable` 的 `ocr` prop 已删除）。各工作台通过 `ocrTargets`（`{ tableId, title, expectedCellCount, apply }`）提供写回闭包，二维表格一律用 `frontend/src/lib/ocr-apply.ts` 的 `applyOcrValues` 填格，已跳过只读列（序号、按行序推导的角度），不要各写一份。
- AI Prompt 有两版，见 `frontend/src/lib/experiment-prompt.ts` 的 `PromptSource`：`photo`（默认，记录纸照片，读数不确定）与 `electronic`（仪器导出/CSV/Excel，数值确定）。共用第一~四、六~七、十节；只允许在 header、第五节填写规则、第八节第 5 条、第九节自检清单上分叉，别把照片版的取数约束带进电子版。

### 本地草稿只认 `physlab:draft:v1:<slug>`

三个工作台（通用、声速光速、偏振光）的自动保存走 `frontend/src/hooks/useWorkspaceDraft.ts` + `frontend/src/lib/workspace-draft.ts`：

- key 前缀固定 `physlab:draft:v1:`，`v1` 是草稿结构版本；改 `DraftPayload` 结构就递增版本，别在原版本上兼容旧数据。
- 写入必须等 `ready`（配置/spec 就绪）与 `hydrated`（首帧基线已抓到）都为真；基线是 **restore 之前** 的快照，当前序列化 ≠ 基线才写入，等于基线则删 key。这条是“打开页面不产生草稿、不误报已恢复”的唯一依据。
- 清空“全部”只遍历前缀，禁止 `localStorage.clear()`（会连带删掉 `physicslab-anonymous-session`、`physlab:admin-key`）。
- 草稿快照/恢复 **不要** 复用 `collectArtifact`/`encodeArtifact`：导出链路会裁末尾空行、把数值字符串转成数字，草稿必须原样保留半成品输入（`-`、`1e`）与额外空行。
- 清空后必须一并清 `result`/`processed`/`step` 等派生状态，避免“数据空了结果还在”。

## 踩坑记录

### 1. OCR 样本测试失败≠代码 bug

`tests/test_ocr_builder.py::test_every_public_experiment_produces_samples` 失败，通常是某个实验的记录表改了排版而标定没跟上。做法：

1. 单跑该测试，从 `produced` 字典定位是哪个实验为 0；
2. 先干跑 `ocr_dataset.calibrate --experiment <slug>` 看坐标差异是否符合预期；
3. `--write` 标定，再 `templates --write`，最后 `templates --check`；
4. `git status` 确认只有目标实验的布局/模板变化，其余实验用 `git checkout --` 还原。

### 2. 生成 JSON 的换行会污染整份 diff

仓库统一用 LF。Python `Path.write_text` 在 Windows 上默认写 CRLF，重新生成模板后整份文件都会显示为改动。提交前看 `git diff --stat`：若增删行数恰好等于文件行数，就是换行问题，归一为 LF 再提交。

### 3. `vinext build` 首次构建慢，别在前台干等

构建分两步：Vite 8 / Rolldown 打包（约 1–2 秒）→ 起临时生产服务预渲染全部路由（约 10 秒）。首次还要做依赖优化，比稳态慢，但已远快于 Next 时代的 8 分钟。仍然不要在前台干等：

- 用后台进程把 stdout/stderr 重定向到日志文件，轮询日志与 `Test-Path frontend/out`；
- 构建残留（`dist/`、`.vinext/`、`out`、日志）不要进入提交；
- `dist/server` 是预渲染要用的服务端包，不是产物；上线只认 `frontend/out`。

### 4. `vinext` 每次 build/dev 都会重写 `next-env.d.ts`

`frontend/next-env.d.ts` 已改为**不跟踪**（见 `.gitignore`）：vinext 每次都会重写它，并引用并不存在的 `./.next/types/routes.d.ts`。类型入口是 `frontend/src/vinext-env.d.ts`（`import "vinext/types"`），`tsc` 的 `include` 也不含 `next-env.d.ts`——不要把两者混在一起。

### 5. 失败先对照干净 HEAD

怀疑某个失败是本次改动引入时，用 `git worktree add --detach <临时目录>/physlab-head HEAD` 建一个干净副本跑同一条测试（用完 `git worktree remove` 清理）。既有漂移和本次回归要区分开，避免把无关修复塞进当前提交。

### 6. UI 改动要看得见

类型检查和单测通过不代表界面正确。改动工作台后，起服务用 Playwright 截图或量测：工具条对齐、弹窗、备注卡片、导入确认、AI 参考值这些都要实际看一眼。临时脚本用完删除，不要留在仓库里。

没有 Playwright 也能截图（实测可用，零依赖）：自己起一个无头 Edge，用 CDP 驱动。

```bash
"/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" \
  --headless=new --remote-debugging-port=9444 --remote-allow-origins=* \
  --user-data-dir="$TEMP/edge-cdp" --no-first-run --no-default-browser-check \
  --disable-gpu --window-size=1440,1200 about:blank
curl -s --noproxy '*' http://127.0.0.1:9444/json/version   # 确认端口
```

- 用 `PUT /json/new?about:blank` 开标签页拿 `webSocketDebuggerUrl`，Node 22 自带 `WebSocket` 直接发 `Page.navigate` / `Runtime.evaluate` / `Input.insertText` / `Page.captureScreenshot`；
- 键入读数要用 `Input.insertText`（React 受控输入会正常收到 onChange），再用 `Runtime.evaluate` 读回 `.value` 断言位数没被吃掉；
- 只连自己起的实例（单独端口 + 独立 `--user-data-dir`），**不要**碰用户已开的浏览器；
- 服务端仍要按第 7 条 detach 启动，收尾 `npm run stop` 并复查端口释放。

### 7. 常驻服务绝不能在前台跑

`npm run dev` / `npm run prod` 按设计**独占当前控制台**，直到 `Ctrl+C` 或 `npm run stop`（命令与参数 refer to `README.md`「本地运行（开发者）」）。在代理会话里前台执行只有两种结局：等到超时，或超时被杀并连带打断正在跑的构建。

- 一律 `npm run dev|prod -- --detach --no-browser`，收尾 `npm run stop`；
- 也不要在单条命令里长时间 `Start-Sleep` 轮询：先 detach 启动，再用另一条短命令查状态，保持会话可响应；
- 停完必须复查：`listeners=0`（`Get-NetTCPConnection -LocalPort 8001,3000 -State Listen`），且没有残留 `dev.mjs` / `dev.ps1` / `uvicorn` / `serve-static` 进程；
- 按端口停不掉父进程时整棵树杀：`taskkill /PID <pid> /T /F`（Windows）、`pkill -P <pid>`（bash）。只杀监听进程会留下 `npm`/`dev.mjs` 空壳。

### 8. 构建必须串行，锁由脚本自己维护

vinext 落 `out` 的方式是「先写 `dist/` 再落静态文件」，两个构建并发会互相清空 `frontend/out`，得到缺页的产物（症状：部分深链 404、`out` 里只剩几个目录）。

- 锁文件是 `frontend/.build.lock`（`scripts/dev.ps1` / `dev.sh` 创建与清理），与构建工具无关；Next 时代的 `.next/lock` 已不存在，别再照旧去删它；
- 同一时刻只允许一个构建，别“边等边再发一条”；
- 发现残留锁时先确认没有存活构建：
  `Get-CimInstance Win32_Process -Filter "Name='node.exe'" | ? { $_.CommandLine -match '(vinext|vite).*build' }`，再 `taskkill /PID <pid> /T /F`；
- 被强杀后 `frontend/out` 可能为空或缺失，属正常，重跑一次构建即可，不要手工拼产物。

### 9. 构建脚本自己清理导出目录

构建内部会清 `frontend/out`，在 Windows 上可能被 IDE 的安全删除钩子拦掉并报 ENOENT。清理已由 `scripts/dev.ps1` / `scripts/dev.sh` 负责（实现细节见脚本内注释，用法 refer to `README.md`）：**不要在半路手动删 `dist` / `.vinext` / `out` 后中断构建**。

### 10. MCP stdio 自测：stdout 只有协议帧，收尾别靠官方客户端

- **现象**：临时脚本用 `mcp.client.stdio.stdio_client` 起 `backend/mcp_server.py` 会卡住不返回，并留下孤儿 `python.exe`（脚本与 server 各一个），看起来像「服务端不应答」；实际 `initialize` / `tools/list` 早已正常返回（单帧耗时 ~2 s）。
- **病因一（收尾）**：官方客户端的子进程收尾在 Windows 上会挂住，与业务代码无关。
- **病因二（探针写法）**：`subprocess.run(input=整段 JSON-RPC)` 写完立刻 EOF，服务器处理完前几帧就退出，后面的 `tools/call` 拿不到响应；必须用 `Popen` 保持 stdin 开启，按行读 stdout 并给每帧设超时，最后 `kill`。
- **正确自测**：`npm run mcp:check`（`scripts/mcp.mjs` 转发到 `backend/mcp_server.py --check`，清单打到 stderr）；协议层回归不必起客户端，`backend/tests/test_mcp_tools.py` 直接调纯函数。
- **MCP 只在本机**：`backend/Dockerfile` 不 COPY `mcp_server.py` / `physlab_mcp/`，`backend/.dockerignore` 也把两者排除，云端只跑 `uvicorn`。别为了「容器里也能跑」把 COPY 加回去——部署产物里出现 MCP 即视为回退（见 `docs/deployment.md`「MCP 不在部署范围内」）。
- **清孤儿**：`Get-CimInstance Win32_Process -Filter "Name='python.exe'" | ? { $_.CommandLine -match 'mcp_server|probe' }` 后逐个 `taskkill /PID <pid> /T /F`（PowerShell 里 `$pid` 是只读内置变量，循环变量换个名字）。
- **纪律**：stdio 下日志一律走 stderr，入口脚本已强制 `MPLBACKEND=Agg`（否则 matplotlib 可能弹窗/写 stdout 破坏协议）。

### 11. CloudBase 部署：体验版没有云托管，CORS 要回填

流水与参数 refer to `README.md`「部署到 CloudBase」（`npm run deploy -- --help` 看全部）。实测环境 `leon-cloudbase-d7g86m8ebf2db3e6f`（体验版、国际站）：

- **后端阶段必然失败**：`tcb cloudrun deploy` 报 `[CreateCloudRunServer] 云托管资源未开通`、exit 4。体验版不含云托管，开通前只能用 `npm run deploy:frontend -- --api-url <已有后端>` 发前端。
- **静态托管可用**：成功标志是 `Successfully uploaded N file(s)`；域名用 `tcb hosting detail -e <envId>` 查（`tcb app list` 在本环境无输出，不要依赖它）。
- **CORS 只对 CloudBase 云托管生效**：`deploy/cloudbase.env.json` 的 `CORS_ORIGINS` 是容器环境变量；后端跑在别处（如 Google Cloud Run）要改那边，否则页面能打开、接口全被浏览器拦。验证方式：带 `Origin: <站点域名>` 请求 `/health`，看响应头是否有 `Access-Control-Allow-Origin`。
- **首次前端构建约 8 分钟**（本机 Turbopack 全量编译），按第 3 条后台重定向 + 轮询，不要前台干等；`frontend/out` 与 `.dev-logs/` 已被忽略，别提交。
- **环境变量是全量覆盖**：`--env-params` 整体替换线上变量，改配置只改 `deploy/cloudbase.env.json`。

### 12. 用编辑工具改 CRLF 文件会得到整文件 diff

`backend/experiments/polarization/docbuild.py` 在工作区是 CRLF（仓库没有 `.gitattributes`）。用按行拼接的编辑工具改一段代码，会把整个文件归一成 LF，`git diff` 看起来像重写了 700 行：

```
git --no-pager diff --numstat -- <path>                     # 增删行数 ≈ 文件行数
git --no-pager diff --ignore-cr-at-eol --numstat -- <path>  # 只剩真实改动行数
```

处置：`git checkout -- <path>` 还原，再用 Python 按字节替换（`d.replace(b"""old""", b"""new""")`，中文直接写进字节串），这样换行不变。不要用 `Path.write_text` 重建整份文件。

### 13. 完成度卡片新增按钮会掉成孤行

`GenericExperimentWorkspace` 底部的「必做实验完成度」卡片是 `sm:flex-row sm:items-center`，右侧按钮组原来只有 3 个；再加两个完整报告格式后，1280 宽下第 5 个按钮会换到下一行并停在左侧文字下方，看起来像错位。

处置：右侧改成上下两行容器（`flex-col items-end`）：主行 `预览结果 / 报告 Word / 报告 PDF`，次行 `更多格式 Markdown / JSONC`（`h-8` 小号描边按钮）。验证要看 `getBoundingClientRect().right <= innerWidth` 并截图，别只跑类型检查。

### 14. 草稿表 id 与工作台 cell key 不是一回事

`soundlight` 的 spec 表 id 是 `${methodId}-${tableIndex}`（草稿、`DRAFT_TABLE_OPTIONS` 都用它），但 `SoundLightWorkspace` 内部 `cell` 的 key 是 `${methodId}#${tableIndex}`。恢复时若把 `rowsToGrid` 的结果写进 `${id}-${ti}`，`getRows` 读不到 → 页面仍是空表；随后自动保存又会把“空的当前状态”写回，key 被删，症状是「刷新后数据全没了，而且提示条消失」。验证方式：填值 → 刷新 → 单元格必须有值且出现提示条。

### 15. `fixed inset-0` 弹窗会被卡片的 `backdrop-filter` / `transform` 收进卡片

工作台卡片用了 `backdrop-blur`，`animate-rise-in` 一类动画也会留下 `transform`；两者都会给后代 `fixed` 元素创建包含块，遮罩不再是视口大小：1280×720 下确认弹窗 `top` 量到 580、`bottom` 741 直接出屏；`ArtifactActions` 的导入弹窗同样会被锚到 `animate-rise-in` 区块（1440×900 下 `y=607`，底部落到 1012，只有一半在屏内）。

处置：所有浮层一律 `createPortal(..., document.body)`（`WorkspaceDraftControls` 的确认框、`ArtifactActions` 的导入/导出弹窗都已这么做），并加 `mounted` 门避免 SSR 期访问 `document`。判断方法：`document.querySelector('[role=dialog]').getBoundingClientRect()` 的 `bottom` 必须 ≤ `innerHeight`，且遮罩父节点的 rect 等于视口。

### 16. 下拉菜单在矮视口会被底边裁掉

“清空数据”菜单约 360px 高；声光工作台按钮位于 y≈420（720 视口），向下展开会越过底边，末档「清空所有实验的数据」点不到。处置：打开时按 `innerHeight - rect.bottom < 420` 决定向上展开，并给面板 `maxHeight: min(26rem, calc(100dvh - 7rem))` + `flex flex-col`，列表区 `flex-1 overflow-y-auto`、头尾 `shrink-0`，保证三档按钮始终可见。380px 窄屏还要复查 `document.documentElement.scrollWidth === innerWidth`。

### 17. reload 后整屏 `chrome-error` / 502 ≠ 服务挂了

`next dev` 按需编译期间 reload，浏览器可能落到 `chrome-error://chromewebdata/`，此时 `localStorage` 访问报 `SecurityError`、`Invoke-WebRequest` 也可能拿到 502，看起来像后端崩了。先查端口：

```
Get-NetTCPConnection -LocalPort 8001,3000 -State Listen -ErrorAction SilentlyContinue
```

有监听就重新 `goto` 同一深链（必要时等 2s），没有监听才按「本地运行（开发者）」重新 `npm run dev -- --detach --no-browser`。别在报错页上继续 `eval` 判断业务逻辑。

### 18. sound-light 的校验、arrays、报告三处都按「列名 / 长度 / 段位」隐式耦合

`backend/experiments/soundlight/` 是手写行式引擎，不是通用 `ConfiguredExperiment`，改它时踩过下面五个坑（时差法 tof 改造时全部命中）：

1. **按列名写的守卫会跨方法误伤**。`engine.analyze` 里 `for key in ("T","dt")` 的 `>0` 检查本意是光速法的比值分母与差频周期，但 tof 的列名也叫 `T`，于是「T 必须全部大于零，不能删除无效测量点后计算」把整组 tof 判死。任何整列级校验都必须先按 `method` 分派（`light_square` 在 441 行已归一成 `light_sine`）。
2. **`arrays` 混进 `None` 或非数值键 = 假「计算失败」**。`analyze` 末尾的有限性检查对 `None` 调 `math.isfinite` 会抛 `TypeError`，被兜底成 `计算失败：…`，看起来像数值崩溃，实际是结构问题。原始表需要保留空位时用 `L_all/T_all`（可含 `None`），并让 `_assert_finite` 只校验数值项。
3. **报告原始数据表的行数由 `_seq_filled` 的 filler 长度决定**（`docs.py:344`）。用剔除后的 `L/T` 渲染 `sl_2_tof` 会让表静默少行、后面整表错位；必须用原样录入的 `L_all/T_all`。
4. **`report_blocks` 走 `_table_entries`，只从 `_raw_blocks` 里挑 `kind=="table"`**，同一函数里 `_cap(...)` 生成的说明文字会在正式报告里被丢掉。给读者看的说明只能放第三部分（`_proc_1c` / `_analysis_blocks`），或改用表格区的标题。
5. **`latex()` 是 Matplotlib mathtext，不能含中文**。写了 `\text{诊断量}` 会刷一屏 `Font 'rm' does not have a glyph ... substituting with a dummy symbol`，PDF/Word 里变成方块。中文说明写在 `_cap` 正文，公式只放符号。

另外：`SoundLightWorkspace.tsx` 的 `isMethodFilled` 原本要求每个格子非空，只要 tof 表里有空格子，「完整报告」的请求体就**不含**该方法且不再报错（静默漏方法）。放宽容错计算的方法必须同步放宽这里。

### 19. 数据收集同意只有一个门、一个 key

「匿名化数据收集」现在不再是入口模式，而是报告生成前的一次性询问。改动时守住三条：

- **偏好 key 固定 `physlab:data-collection-consent:v1`，且不得落进 `physlab:draft:v1:` 前缀**——`DraftClearMenu` 按前缀清扫，key 一旦落在里面，用户清草稿会顺手把「已询问」状态删掉，下一次生成报告又弹一次。判定集中在 `frontend/src/lib/data-collection-consent.ts` 的 `shouldPrompt`，`frontend/tests/data-collection-consent.test.ts` 覆盖 `enabled/ready/hydrated` 三种不该弹的情况。
- **门只在 `downloadFinalReport` 里 `await gate.ensureDecided()`，不要在按钮 `onClick` 上重复实现**。门是 Promise，调用方 await 之后 `act()` / `runDownload()` 的 busy 幂等与错误处理原样生效；写成 `setPending(fn)` 会踩「函数被 React 当成 updater」的坑，并且绕开 busy 后连点会弹两次。
- **照片入口必须同时存在于两处**：导出弹窗 `完整报告` 页签里的常驻面板（`DataCollectionOptInRow` 的 `variant="panel"`，开关 + 照片 + 未开放说明），以及报告区的紧凑一行 `variant="row"`。弹窗只问一次，每次实验的记录表都是新的一张；只把 `<input type=file>` 放在一次性询问里，第二次实验起就不会有 session，`commit` 静默 early-return，收集链看起来还活着但数据没了。
- **面板不允许「后端没开就整个消失」**：`/api/data-collection/status` 返回 `enabled:false`（本地没建 `backend/.env.local` 时的默认值）时，旧的常量行直接 `return null`，于是「导出报告时看不到匿名分享」这件事无法自查。panel 变体必须落在「当前部署未开放 + 一句原因」的可读状态上，开关置灰、隐藏「设置」入口。
- 新增弹窗一律 `createPortal(..., document.body)` + `mounted` 门（静态导出首帧没有 `document`），见第 15 条。

### 20. dev 服务器只监听 `localhost`（IPv6），`127.0.0.1` 连不上

`vinext dev` 起在 `http://localhost:3000/`，实际绑定 `::1`。用 `http://127.0.0.1:3000` 请求会直接 `Connection refused`（不是 Next 时代那种「能看不能点」）。

- 截图 / 量测 / curl 一律用 `http://localhost:3000`；
- 若一定要走 IPv4，加 `--host 127.0.0.1` 启动。

### 21. `NEXT_PUBLIC_*` 必须自己在 `vite.config.ts` 里 `define`

vinext 只给「**已经存在**于 `process.env` 的 `NEXT_PUBLIC_*`」生成 define 条目。变量未设置时不会兜底，浏览器端会残留裸 `process.env.NEXT_PUBLIC_API_URL`，模块顶层直接 `ReferenceError`——整站白屏，但构建照样成功。

- `frontend/vite.config.ts` 的 `publicEnv()` 负责补：未设置时定义成字面量 `undefined`，从而保住 `src/lib/api.ts` 的 `??`（空串 = 同源）语义；
- 新增 `NEXT_PUBLIC_*` 变量时，必须同时加进 `define`，否则本地不设就会白屏、CI 设了却看不出问题。

### 22. Git Bash 会把 `/repo` 这类环境变量值改写成 Windows 绝对路径

`NEXT_PUBLIC_BASE_PATH=/Fuck-HUST-PhysExperiments npm run build` 在 Git Bash 里传进 Node 的值会变成 `D:/Program Files/.../Fuck-HUST-PhysExperiments`，于是 vinext 把这个绝对路径当成 `assetPrefix`，构建直接报 `Invalid pattern ... patterns can be neither absolute nor relative paths`。

- 本地验 basePath 用 PowerShell，或 `node -e "process.env.NEXT_PUBLIC_BASE_PATH='/repo'; require('child_process').spawnSync('npm',['run','build'],{stdio:'inherit',env:process.env})"`；
- CI（Ubuntu）不受影响，别拿本地这个报错去怀疑 `deploy-pages.yml`。

### 23. `basePath` 非空时 vinext 会把产物嵌一层 `out/<basePath>/`

静态导出在 `basePath` 非空时沿用 Next 的 assetPrefix 语义，把整棵产物写进 `out/<basePath>/`（`404.html` 仍留在 `out/` 根）。直接上传 `frontend/out` 到 GitHub Pages 会得到 `/<repo>/<repo>/...`。

- `frontend/scripts/build.mjs` 负责在构建后把嵌套层拆平，磁盘布局恒为 `out/_next/**`，HTML 里的 URL 仍带 `/<repo>/` 前缀；
- 因此 **`npm run build` 是唯一正确的发布入口**；`npx vp build` 不经过这层包装，只适合 `NEXT_PUBLIC_BASE_PATH` 为空的本地校验。

### 24. Playwright 只能从 npx 缓存绝对路径导入

仓库没有 `playwright` 依赖，`npm root -g` 里也没有；`npx playwright --version` 能跑是因为它在 npx 缓存里。临时脚本用 `import ... from "playwright"` 会 `ERR_MODULE_NOT_FOUND`（`NODE_PATH` 对 ESM 无效）。

- 路径：`file:///C:/Users/Leon/AppData/Local/npm-cache/_npx/<hash>/node_modules/playwright/index.mjs`（`ls ~/AppData/Local/npm-cache/_npx/*/node_modules/playwright` 认领）。
- 缓存里的 playwright 版本与已装浏览器版本常常对不上（`Executable doesn't exist at ...chromium_headless_shell-1247`），直接用 `chromium.launch({ channel: "chrome" })` 走系统 Chrome，别去 `npx playwright install`。
- **`chrome --headless --screenshot` / `msedge --dump-dom` 在代理会话里可能静默失败**（连 `--version` 都没有输出）。此时连本机已开的 Edge 更稳：找 `--remote-debugging-port`（本机常用 `9333`），`curl http://127.0.0.1:9333/json/version` 确认后 `chromium.connectOverCDP("http://127.0.0.1:9333")`，**只 `context.newPage()` 开新标签页、用完 `page.close()`**，别碰用户已有标签页。
- 临时脚本放 `.dev-logs/`（已忽略），收尾连同截图一起删。

## 提交习惯

- 提交信息用中文 Conventional Commits，scope 取模块名：`feat(workspace): ...`、`fix(gmr): ...`、`docs(readme): ...`。
- 提交前 `git status` 自查：不提交 `dist`、`.vinext`、`out`、`frontend/.build.lock`、`frontend/next-env.d.ts`、构建日志、临时脚本（`scripts/_tmp_*`、`backend/_tmp_*.py`）。
- 一次提交聚焦一个主题；跨端改动（config + 前端 spec + 测试）放同一次提交，保证任一提交点都可构建。
