# MCP 接入（可选）

PhysLab 可以作为 **MCP Server**，把「选实验 → 取结构 → 校验 → 计算 → 出报告」这套能力暴露给 codex、opencode、CodeBuddy、Claude Desktop 等 AI 客户端。用户在客户端里说「用这组迈克尔逊数据算波长并生成报告」，代理就会调用本项目的工具完成计算与文档生成。

- 两种用法（网页 / MCP）**共用同一套计算核心**（`experiments.core.registry`），结果一致。
- **只在本机跑**：MCP 是本地能力，不监听端口、不走网络，也**不随 HTTP 后端一起上云**——`backend/Dockerfile` 不打包 `mcp_server.py` / `physlab_mcp/`，`backend/.dockerignore` 把它们排除在 Cloud Run 构建上下文外，`npm run deploy` 与部署编排都不会启动它。
- 全部计算在本地完成，不调用任何外部模型；工具层不记录用户数据（见「日志与隐私」）。

## 前置

```bash
# 依赖（一次性）：requirements.txt 里包含 mcp>=1.2,<2
cd backend && pip install -r requirements.txt
```

自检（不启动协议，只把工具清单打到 stderr；在**仓库根目录**执行）：

```bash
npm run mcp:check          # 推荐：scripts/mcp.mjs 会定位 .venv 解释器并检查 mcp 依赖
python backend/mcp_server.py --check   # 等价的手写方式
```

能看到 9 个工具名即表示依赖、路径、实验注册表都正常。若报错，优先看这条命令的 stderr。

## 本地运行

| 命令 | Vite+ | 作用 |
|---|---|---|
| `npm run mcp:check` | `vpr mcp:check` | 打印工具清单后退出 |
| `npm run mcp` | `vpr mcp` | 前台启动 stdio 服务器（日志在 stderr），`Ctrl+C` 结束；参数原样转发给 `mcp_server.py`，如 `npm run mcp -- --list-tools` |

- `scripts/mcp.mjs` 按 `PHYSICSLAB_PYTHON` → `.venv/Scripts/python.exe` → `.venv/bin/python` → PATH 的顺序找解释器，找不到或没装 `mcp` 会直接报错并给出安装命令。
- 日常不需要 `npm run mcp`：AI 客户端按上面的配置直接拉起 `backend/mcp_server.py`，包装脚本只是给人工自检用。
- Vite+ 用户注意：`vpr` 会把 `--` 原样传给脚本，附加参数直接写在任务名后（`vpr mcp --list-tools`），与 npm 的 `npm run mcp -- --list-tools` 不同。

## 工具清单

| 工具 | 作用 | 是否写盘 |
|---|---|---|
| `list_experiments` | 实验清单、分类、子实验，以及三种 `data` 结构说明 | 否 |
| `get_experiment_config` | 某个实验的方法 / 列 key / 参数 key / 单位 / 建议范围 | 否 |
| `get_experiment_schema` | 该实验的 2.0 JSON schema（与前端导入格式一致） | 否 |
| `get_data_reference` | 该实验的「数据特征参考」：典型量级、填写规律、常见错误 | 否 |
| `validate_experiment_data` | 只校验，返回 `{valid, errors, warnings}` | 否 |
| `process_experiment_data` | 计算 + 误差分析 + 最小二乘拟合，返回 `results/derived/errors/plots` | 拟合图落盘 |
| `generate_experiment_report` | Word / PDF 实验报告 | 是 |
| `generate_record_sheet` | 空白数据记录表（打印后手写） | 是 |
| `recognize_record_sheet` | 手写记录表照片 → 数值候选（需人工确认） | 否 |

显式开启数据共建后额外出现 4 个工具（默认不注册）：

| 工具 | 作用 |
|---|---|
| `data_collection_status` | 查看共建模式开关状态与模板版本 |
| `contribute_record_sheet` | 上传脱敏记录表（需 `consent=true`） |
| `commit_contributed_data` | 提交用户确认后的数据（需 `consent=true`） |
| `withdraw_contribution` | 撤回并删除该次贡献 |

## data 的三种结构

`list_experiments` 会为每个实验返回 `payload_kind` 与对应的 `request_shapes`，照抄即可，不要猜字段名。

```jsonc
// general：11 个实验（michelson、bridge、gmr、viscosity …）
{"<方法ID>": {"rows": [{"<列key>": 1.23}], "params": {"<参数key>": 0.5}}}

// polarization：扁平对象
{"bg_uw": 0.0, "theta_qwp": 30.0,
 "malus": {"rows": [{"theta": 0, "i_left": 12.3, "i_right": 12.1}]},
 "halfwave": {"initial": {"c_deg": 0, "p2_deg": 0}, "rows": []},
 "quarterwave": {"rows": [{"phi": 0, "i_raw": 1.2}]},
 "circular": {"rows": [{"angle": 0, "i_raw": 1.2}]}}

// sound-light：一次一个方法
{"method": "<方法ID>", "rows": {"<列key>": [1.2, 1.3]}, "params": {"<参数key>": 0.5}}
```

`validate_experiment_data` / `process_experiment_data` 用上面三种结构；报告工具额外接受 `{"data": <上面的结构>}` 包裹形式。

## 产物：落盘 + 路径

报告、记录表、拟合图都写成文件，返回：

```json
{"status": "success", "experiment_id": "michelson", "fmt": "pdf",
 "file": {"path": "C:\\Users\\me\\AppData\\Local\\Temp\\physlab-mcp\\迈克尔逊干涉实验-实验报告-20261025-200322-1a2b3c.pdf",
          "mime": "application/pdf", "bytes": 226484,
          "filename": "迈克尔逊干涉实验-实验报告-20261025-200322-1a2b3c.pdf"}}
```

- 默认目录：系统临时目录下的 `physlab-mcp/`；用 `PHYSICSLAB_MCP_OUTPUT_DIR` 指定固定目录。
- 文件名格式：`<实验名>-<用途>-<时间戳>-<6 位随机>.<ext>`，已清洗 Windows 非法字符，不会覆盖旧文件。
- `process_experiment_data` 的 `plots` 值会被替换为 `{path, mime, bytes, filename}`；给 `inline_plots=true` 时才返回 `data:image/png;base64,…`（大响应，仅在需要直接看图时用）。
- 只读工具（清单/config/schema/校验）不产生任何文件。

## 接入配置

三份配置只差写法，`command` 一律写**虚拟环境 python 的绝对路径**，`args` 写入口脚本的绝对路径（相对路径取决于客户端的工作目录，容易踩坑）。

### codex（`~/.codex/config.toml`）

```toml
[mcp_servers.physlab]
command = "D:/Projects/Fuck-HUST-PhysExperiments/.venv/Scripts/python.exe"
args = ["D:/Projects/Fuck-HUST-PhysExperiments/backend/mcp_server.py"]
startup_timeout_sec = 30
```

### opencode（`opencode.json`）

```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "physlab": {
      "type": "local",
      "command": [
        "D:/Projects/Fuck-HUST-PhysExperiments/.venv/Scripts/python.exe",
        "D:/Projects/Fuck-HUST-PhysExperiments/backend/mcp_server.py"
      ],
      "enabled": true
    }
  }
}
```

### CodeBuddy / Claude Desktop（`mcpServers` 结构）

CodeBuddy：设置 → MCP → Add MCP，在打开的 JSON 里填；Claude Desktop 填 `claude_desktop_config.json`。

```json
{
  "mcpServers": {
    "physlab": {
      "type": "stdio",
      "command": "D:/Projects/Fuck-HUST-PhysExperiments/.venv/Scripts/python.exe",
      "args": ["D:/Projects/Fuck-HUST-PhysExperiments/backend/mcp_server.py"],
      "description": "PhysLab 大学物理实验数据处理"
    }
  }
}
```

> Linux / macOS 把 `command` 换成 `<仓库>/.venv/bin/python`。

## 环境变量

| 变量 | 默认 | 说明 |
|---|---|---|
| `PHYSICSLAB_MCP_OUTPUT_DIR` | 系统临时目录 `/physlab-mcp` | 报告、记录表、拟合图的输出目录 |
| `PHYSICSLAB_MCP_LOG_LEVEL` | `INFO` | 日志级别，始终写 stderr |
| `PHYSICSLAB_MCP_ENABLE_DATA_COLLECTION` | 关闭 | 注册数据共建工具 |
| `ENABLE_DATA_COLLECTION` | 关闭 | 后端共建存储的总开关 |

共建工具需要**两个都开**：入口脚本会读取 `backend/.env.local`（与 `uvicorn` 相同的加载逻辑），所以把开关写进 `.env.local` 即可；客户端配置里的 `env` 也可以覆盖。

## 日志与隐私

- 日志只记工具名、实验 ID、耗时、产物字节数与错误文案，**不记**用户测量数据、图片内容、base64。
- OCR 候选值必须由使用者逐项确认；`recognize_record_sheet` 的返回里带 `note` 提醒。
- 贡献前需自行删除姓名、学号、联系人与人脸；系统只做重新编码去元数据，不识别个人信息；`consent` 不为 `true` 时直接拒绝。

## 排障

| 现象 | 原因与处置 |
|---|---|
| 客户端里看不到工具 / server 启动失败 | 先单独跑 `python backend/mcp_server.py --check`；再确认 `command` 是**绝对路径**且该 python 装了 `mcp`（`pip show mcp`） |
| Windows 路径写不对 | TOML 用正斜杠或双反斜杠；JSON 里用正斜杠（`"D:/..."`）。别用单反斜杠，会被当转义符 |
| 第一次调用等 1~3 秒 | 正常：`numpy` / `matplotlib` / `python-docx` 的导入开销；之后同一进程内是毫秒级 |
| 客户端说「无法解析响应」 | 说明有东西写进了 stdout。stdio 下 stdout 只属于协议帧，日志必须走 stderr，任何 `print()` 都要删掉；`MPLBACKEND` 已由入口脚本强制为 `Agg` |
| 报告返回错误「请先填写完全部必做实验：…」 | 必做子实验没填完整；先 `validate_experiment_data` 看 `errors`，或补齐必做方法的行 |
| 找不到生成的报告 | 看返回的 `file.path`（绝对路径）；想固定位置就设 `PHYSICSLAB_MCP_OUTPUT_DIR` |
| 自测脚本卡死并留下 `python.exe` | 若用 `mcp.client.stdio.stdio_client` 起子进程，Windows 上退出阶段可能挂住。收尾要显式关闭 stdin 再 kill，或用 `Get-CimInstance Win32_Process` 找到 `mcp_server.py` 后 `taskkill /PID <pid> /T /F` |

## 边界

- 只提供 stdio，不提供 HTTP / SSE 端点，也不改 `uvicorn` 启动方式。
- **不进部署产物**：MCP 是开发者本机能力，云端只跑 HTTP 后端。不要为了「容器里也能跑」往 `backend/Dockerfile` 加 `COPY mcp_server.py` / `COPY physlab_mcp`，也不要在 Compose / Worker / CloudBase 配置里加启动命令；`backend/.dockerignore` 已把两者排除（见 `docs/deployment.md`）。
- 不自研 MCP Client：调用方就是 codex / opencode / CodeBuddy 这些既有代理。
- 不暴露 `/api/data-collection/stats`（需要 admin key）。
