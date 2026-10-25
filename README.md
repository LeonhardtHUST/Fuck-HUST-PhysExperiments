# PhysLab

### AI-powered Physics Laboratory Assistant

PhysLab 是一个面向大学物理实验的 AI 助手。它帮助学生完成实验数据处理的最后一公里：

- **实验数据录入** —— 手写记录表拍照上传，自动识别成数据
- **数据处理** —— 计算、误差分析、最小二乘拟合
- **曲线绘制** —— 结果图自动生成并按报告规范排版
- **实验报告** —— 一键导出含数据表、图像与计算结果的 Word / PDF

> PhysLab **不替代实验**。纸笔记录、动手操作、观察现象仍是实验课的核心；PhysLab 只是把实验之后的数据处理与出图变成一分钟的事。

**在线使用**：<https://bogger111.github.io/Physicallab/> · **问题反馈**：<https://github.com/Bogger111/Physicallab/issues>

---

## Features

### 📷 OCR 辅助实验数据录入

上传手写实验记录表的照片，PhysLab 会定位表格、切出每一个手写数值并给出识别候选。所有候选值都由你确认或修改后才进入计算。

### 📊 自动数据处理

- 数据计算：按每个实验的计算公式与单位自动处理
- 误差分析：相对误差、标准差、相关系数等
- 曲线绘制：验证性实验自动做最小二乘拟合与残差检查

### 📝 实验报告生成

一次导出即可得到：

- 数据表（含原始读数与计算结果）
- 结果图像（拟合曲线、特性曲线）
- 计算结果与误差分析

### 🤖 AI 实验共建

你可以自愿选择「AI 实验共建」模式，在**正常完成实验的同时**，帮助 PhysLab 学习真实实验记录，提升未来实验数据识别能力。

---

## 使用流程

```
1. 选择实验        2. 上传实验记录表     3. AI 辅助识别数据
        ↓                    ↓                     ↓
4. 检查并修改数据   5. 自动计算和绘图     6. 生成实验报告
```

| 步骤 | 说明 |
|---|---|
| 1. 选择实验 | 打开实验库，选择本次要做的实验（支持 12 个大学物理实验） |
| 2. 上传实验记录表 | 拍照或扫描手写记录表上传；也可以直接手动录入 |
| 3. AI 辅助识别数据 | 系统按实验模板切出每个数值并给出识别结果 |
| 4. 检查并修改数据 | 逐项确认；表格里可以直接改，超范围会给出提示 |
| 5. 自动计算和绘图 | 点击处理后自动完成计算、拟合与出图 |
| 6. 生成实验报告 | 下载 Word / PDF 报告，含数据表、图像与计算结果 |

<p align="center">
  <img src="docs/images/home.png" alt="PhysLab 首页" width="720">
</p>

<table>
<tr>
<td width="50%"><img src="docs/images/experiments.png" alt="实验库"><br><sub>实验库：12 个大学物理实验</sub></td>
<td width="50%"><img src="docs/images/workspace.png" alt="实验工作台"><br><sub>工作台：数据录入、计算、绘图与报告</sub></td>
</tr>
</table>

## 支持的实验

| 分类 | 实验 |
|---|---|
| 光学 | 偏振光与双折射、迈克尔逊干涉实验 |
| 波动 | 声速光速的测量 |
| 电磁学 | 万用表的组装与校准、交直流电桥的原理及应用、太阳能电池特性、巨磁电阻效应及应用 |
| 近代物理 | 核磁共振实验、光电效应与弗兰克-赫兹实验 |
| 力学 | 落球法测液体粘滞系数、液体表面张力系数测量 |
| 热学 | 稳态法测固体导热系数 |

每个实验都配有标准记录表（可打印）、数据特征参考（这个实验的数据通常长什么样）与报告模板。

## AI 实验共建模式

AI 实验共建**不是额外任务**：它和普通实验走的是同一个工作台、同一套流程，区别只是实验结束后可以自愿贡献脱敏后的记录表。

```
选择共建模式 → 正常完成实验 → 确认数据 → 贡献脱敏实验记录 → 帮助优化 PhysLab
```

<p align="center">
  <img src="docs/images/cobuild-intro.png" alt="AI 实验共建说明" width="720">
</p>

- **完全自愿**：不参与也完整可用，随时可以切回普通模式
- **不影响正常实验**：录入、计算、绘图、报告流程完全一致
- **可以撤回贡献**：撤回后原图与由它生成的数据样本一并删除

## 数据安全

参与前请先删除或遮盖：**姓名、学号、联系方式**（以及人脸、证件等任何个人信息）。

系统会：

- 删除图片元数据：保存前重新编码，去掉拍摄时间、位置等照片信息
- 仅保存必要实验信息：只保留数值裁剪与最小必要的溯源信息
- 不公开用户实验记录：原始图片保存在私有存储中，不会进入公开仓库

<p align="center">
  <img src="docs/images/report.png" alt="实验报告生成" width="720">
</p>

## 项目架构

```
User
 │
PhysLab（Next.js 界面 + FastAPI 服务）
 │
Experiment Processing（计算 · 误差分析 · 拟合绘图 · 报告）
 │
AI Data Pipeline（模板定位 · 表格切分 · 质量筛选）
 │
OCR Dataset（image, text）
 │
PhysLab_OCR（CRNN + CTC 识别模型训练）
```

PhysLab 负责采集与切分，[PhysLab_OCR](https://github.com/Bogger111/PhysLab_OCR) 负责数据集与模型训练——两个仓库职责分离。

## 开发状态

**当前（2.0）**

- 支持 12 个大学物理实验的录入、计算、绘图与报告
- 支持实验记录表 OCR 辅助录入（候选值须人工确认）
- 支持 AI 实验数据共建闭环：采集 → 确认 → 切分 → 训练集导出
- 后端 387 项、前端 44 项自动测试全部通过

**未来**

- 更多实验（力学、热学、电磁学、近代物理持续接入）
- 更强的 OCR 模型：用共建数据训练后的识别能力提升
- 更多智能实验辅助功能

> 验证边界：计算链、记录表、报告与 OCR 管线均已通过自动测试与合成数据验证；真实手写数据与真实实验读数的端到端验证仍在进行，发布版中的所有 OCR 候选值都需要人工确认。

## 本地运行（开发者）

### 一键脚本

仓库根目录带一个 `package.json`，用 npm 脚本即可启动/构建，跨平台（Windows / macOS / Linux）：

| 命令 | 作用 |
|---|---|
| `npm run dev` | 开发模式：后端 `uvicorn --reload` + 前端 `next dev`，改代码即时生效 |
| `npm run build` | 只构建前端（`next build` 静态导出到 `frontend/out`） |
| `npm run prod` | 先构建，再以**生产产物**启动（后端不带 `--reload` + 静态服务器），页面不再实时渲染，明显更流畅 |
| `npm run stop` | 停掉占用 8001 / 3000 的进程 |

`npm run dev` 只是转发到下面的脚本；需要细粒度参数时直接用脚本：

```bash
npm run prod -- --no-browser --detach     # 构建 + 后台生产模式，不弹浏览器
```

脚本：`scripts/dev.ps1`（Windows PowerShell 5.1 / PowerShell 7）与 `scripts/dev.sh`（bash）。默认**独占当前控制台**运行：日志实时打印、`Ctrl+C` 同时停掉前后端；加 `-Detach` / `--detach` 转后台。

| 环境 | 前台启动 | 后台启动 | 停止 |
|---|---|---|---|
| Windows PowerShell 5.1 | `.\scripts\dev.ps1` | `.\scripts\dev.ps1 -Detach` | `.\scripts\dev.ps1 -Stop` |
| PowerShell 7（pwsh） | `pwsh -File .\scripts\dev.ps1` | `pwsh -File .\scripts\dev.ps1 -Detach` | `pwsh -File .\scripts\dev.ps1 -Stop` |
| Git Bash / Linux / macOS | `./scripts/dev.sh` | `./scripts/dev.sh --detach` | `./scripts/dev.sh --stop` |

参数：

| PowerShell | bash | 作用 |
|---|---|---|
| `-Build` | `--build` | 只构建前端（导出到 `frontend/out`）后退出 |
| `-Prod` | `--prod` | 先构建，再用生产产物启动前后端 |
| `-Install` | `--install` | 强制重装 Python 与 npm 依赖 |
| `-Detach` | `--detach` | 转入后台运行，日志写入 `.dev-logs/` |
| `-Stop` | `--stop` | 停止占用这两个端口的进程后退出 |
| `-NoBrowser` | `--no-browser` | 不自动打开浏览器 |
| `-BackendPort` | `-b, --backend-port` | 后端端口，默认 8001 |
| `-FrontendPort` | `-f, --frontend-port` | 前端端口，默认 3000 |

脚本做的事：首次运行创建 `.venv` 并安装 `backend/requirements.txt`、`frontend/` 执行 `npm ci`；清理端口后启动后端与前端，轮询 `/health` 和首页直到就绪（各 180 秒上限），失败会提示看日志。

- 开发模式：前端 <http://localhost:3000>（`next dev`，热更新）；生产模式：同一个地址，服务的是 `frontend/out` 静态产物，适合演示与验收。
- 后端始终是 <http://127.0.0.1:8001>（API 文档 `/docs`）；前端通过 `next.config.ts` 的 rewrite 把 `/api/*` 代理过去，两种模式一致。
- `npm run prod` 每次都会重新构建；只想看页面就反复用同一个 `prod` 命令即可（构建约 20 秒）。
- 前台模式按 `Ctrl+C` 停止；后台模式用 `-Stop` / `--stop`，日志见 `.dev-logs/`（已被 `.gitignore` 覆盖）。
- PowerShell 报「禁止运行脚本」时：`powershell -ExecutionPolicy Bypass -File .\scripts\dev.ps1`。
- Windows 上跑 bash 版本请用 Git Bash（`.venv/Scripts/python.exe` 与 `.venv/bin/python` 脚本会自行识别）。
- 生产模式的静态服务器是仓库自带的零依赖脚本 `scripts/serve-static.mjs`（等价于 CI 上的静态托管：目录补 `/` 重定向、`index.html` 落盘、404 页面）。

#### `scripts/` 目录

| 文件 | 运行环境 | 作用 |
|---|---|---|
| `dev.ps1` | Windows（PowerShell 5.1 / PowerShell 7） | 主启动脚本：依赖安装、端口清理、`-Build` / `-Prod` / `-Detach` / `-Stop` |
| `dev.sh` | bash（Git Bash / Linux / macOS） | 与 `dev.ps1` 等价，参数为 `--build` / `--prod` / `--detach` / `--stop` |
| `dev.mjs` | 跨平台（npm 脚本入口） | `npm run dev / build / prod / stop` 的分发器，自动选用上面的 `.ps1` 或 `.sh` |
| `serve-static.mjs` | 跨平台 | 生产模式的零依赖静态服务器，托管 `frontend/out`（目录补 `/` 301、`index.html` 落盘、MIME、缓存头、404） |
| `export_ocr_dataset.py` | 跨平台（Python） | 导出经用户明确同意并确认的记录，供后续 OCR 研究使用；不做训练、裁剪或识别 |
| `generate_simulated_reports.py` | 跨平台（Python） | 生成整套合成报告，用于打印排版 QA（数字仅为夹具，不代表真实结果正确性） |

`npm run *` 只负责参数转发，脚本本身可直接调用，例如 `.\scripts\dev.ps1 -Prod -Detach -NoBrowser` 或 `./scripts/dev.sh --prod --detach --no-browser`。

### 手动启动

```bash
# 后端
cd backend && pip install -r requirements.txt
uvicorn app.main:app --port 8001

# 前端
cd frontend && npm install && npm run dev
```

开发开关（可选，默认关闭数据共建）：`backend/.env.local`

```bash
ENABLE_DATA_COLLECTION=true     # 打开数据共建
PHYSICSLAB_DEV_MODE=true        # 打开开发者统计面板
```

更多细节见 [docs/physkiller-2.0.md](docs/physkiller-2.0.md)（架构与流水线）、[docs/screenshots.md](docs/screenshots.md)（截图清单）、[CHANGELOG.md](CHANGELOG.md)（发布说明）。

## 反馈

- 使用问题与建议：<https://github.com/Bogger111/Physicallab/issues>
- 数据共建相关疑问（授权、撤回、隐私）：同样通过 issue 联系

---

HUST 华中科技大学 · 大学物理实验
