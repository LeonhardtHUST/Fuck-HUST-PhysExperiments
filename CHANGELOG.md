# Changelog

PhysLab 的版本记录。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。

## Unreleased

### Added

- **AI Prompt 双版本**：导入弹窗的「AI Prompt」页签可切换「记录纸照片 / 电子数据」。照片版沿用原来的取数约束（只依据图片、看不清留 null、按纸面分辨率保留）；电子版针对仪器导出文件、CSV / Excel 与直接贴出的数据表，改为强调列名映射、单位换算、占位符（`--` / `NaN`）转 null、行数按实际条数输出、精度不按记录表分辨率取整
- **MCP Server（stdio）**：`backend/mcp_server.py` + `backend/physlab_mcp/`，把实验查询、数据校验、计算与拟合、报告/记录表生成、手写记录表识别暴露为 MCP 工具，供 codex / opencode / CodeBuddy / Claude Desktop 直接调用；与网页共用同一套计算核心
- **产物落盘**：报告、记录表、拟合图写入 `PHYSICSLAB_MCP_OUTPUT_DIR`（默认系统临时目录 `physlab-mcp/`），返回绝对路径 + MIME + 字节数，不通过协议传输大段二进制
- **数据特征参考工具**：按 `experiments/*/data_reference.json` 内的 `experiment_id` 建索引，新增实验无需改代码
- **默认关闭的共建工具**：`contribute_record_sheet` / `commit_contributed_data` / `withdraw_contribution` 仅在 `PHYSICSLAB_MCP_ENABLE_DATA_COLLECTION=true` 且 `ENABLE_DATA_COLLECTION=true` 时注册，且每次调用都要求 `consent=true`
- **npm 包装**：`npm run mcp`（前台启动 stdio 服务器）与 `npm run mcp:check`（打印工具清单自检），由 `scripts/mcp.mjs` 自动定位 `.venv` 解释器并检查 `mcp` 依赖
- **报告新增 Markdown / JSONC 导出**：完整报告除 Word / PDF 外可下载 `md`（图片 data URI 内嵌）与 `jsonc`（机器可读、带 `//` 头注释），三个工作台与 MCP `generate_experiment_report` 同时支持；JSONC 结构由 `docs/schemas/report.schema.json` 定义，说明见 `docs/report-format.md`
- `docs/mcp.md`：三份客户端配置片段、`data` 三种结构、环境变量与排障表
- README 增加 Vite+ 用法：`vp run <task>` / `vpr <task>` 与 npm 脚本的对照，以及「`vpr` 不吞 `--`」的差异说明

### Changed

- **导出入口收敛为一个三页签弹窗**：工作台页头的「导出」现在同时承载「完整报告 / 纸质记录表 / 读数 JSON」。原先分散的三组按钮——页头的记录表预览与 Word、独立的「需要纸质记录表？」卡片、报告横幅里的四个格式按钮——全部收进弹窗，页面只留一个「生成完整报告」CTA（通过 `ArtifactActionsHandle` 打开同一个弹窗）。三个工作台（通用、声速光速、偏振光）同步；下载的忙碌态与错误提示也移进弹窗，`act` / `runDownload` 的幂等逻辑不变
- **匿名分享在导出报告时一定可见**：`完整报告` 页签里新增常驻面板（开关 + 附上记录表照片 + 状态说明），替代原先只在报告区显示的一行 11px 小字；后端未开启数据共建时面板不再整体消失，而是显示「当前部署未开放」并置灰开关，报告生成不受影响
- **声速光速实验的时差法（tof）改为 L–T 拟合**：主结果从「逐点 `L/T` 平均」改为 `T = aL + b` 的斜率换算 `v = 1000/a`，逐点均值与标准差降为诊断量（固定系统延迟会让短距离点系统性偏低）。结果卡片、报告汇总表与公式区同步新增 `slope / intercept / r2 / error_rel / valid_points / excluded_points`
- **水中声速参考值统一**：`1480 m/s` 从 `docs.py` 的六处字面量收敛为 `engine.SOUND_WATER_REF` 单一常量，报告正文与相对偏差都引用它
- **移除「AI 实验共建」双入口**：首页的第二颗按钮、实验库的模式提示条、实验详情页的说明卡片与 `?mode=collection` URL 机制全部删除，实验库与详情页链接不再透传模式；旧链接带该参数时静默忽略，行为等同普通链接
- **数据收集改为报告生成前的一次性询问**：首次点任一报告格式按钮时弹一次对话框（复选框「启用匿名化数据收集以帮助改进服务」+ 可选「附上记录表照片」+「继续生成报告」），勾与不勾都继续生成；决定写入 `physlab:data-collection-consent:v1`，之后不再自动弹。报告区常驻一行「匿名化数据收集：已开启 / 已关闭 · 附上记录表照片 · 更改」，照片入口也在这行（弹窗只问一次，每次实验的记录表是新的）。后端接口与 `collection_mode` 语义未改
- **新增 `/privacy` 隐私说明页**：说明收集范围、处理方式、关闭与撤回方式、本地保存的标记，并从首页页脚链接
- **实验数据入口合并为「导入 / 导出」**：工作台工具条不再并列「导出实验数据 / 导入实验数据 / 复制 AI Prompt / 查看 Schema」四个按钮；AI Prompt、Schema、粘贴或选择文件、拍照录入（OCR）、导入备注统一收进「导入」弹窗，导出只保留纯数据导出。拍照录入不再是表格上方的常驻面板，改由导入弹窗按目标表格选择，各工作台通过 `ocrTargets` 提供写回闭包
- **MCP 明确为本地能力**：`backend/Dockerfile` 不再打包 `mcp_server.py` / `physlab_mcp/`，`backend/.dockerignore` 同时把它们排除出构建上下文，云端只部署 `uvicorn` 的 HTTP 后端（见 `docs/deployment.md`）
- **报告允许必做缺项**：生成报告不再被「请先填写完全部必做实验」拦截；未算出结果的必做子实验在报告第三部分标注为「必做项目缺项」并留空，其余已提交数据照常计算，HTTP 路由与 MCP 工具行为一致

### Fixed

- **时差法不再因单个坏点整组失败**：`engine.analyze` 里那条本意服务光速法 `dt/T` 的「必须全部大于零」守卫不再套用到 tof。tof 现在按「计数域解码 → 行级有效性 → 拟合」处理：`T < 0` 视为设备导出的有符号 16 位计数差，仅尝试单次 `+65536` 回绕并通过「隐式声速带宽 + 与其余点相容」双重校验；缺失/`T=0`/`L≤0` 的行逐行剔除。只要有效点 ≥ 3 即继续拟合，少于 3 才失败，且报错不再带「计算失败：」前缀
- **修复过程可见**：新增 `warnings`（`第 N 行：<原因>`）经 `/process` 透出，工作台结果页以黄色提示条列出回绕恢复与剔除明细；下载的报告在「处理 1c」逐条说明，原始数据表始终按录入值原样记录。`isMethodFilled` 同步放宽，含空格的 tof 不再被「完整报告」静默漏掉
- **构建被中断后不再被残留锁卡死**：构建中断（崩溃 / IDE 批量删除守卫拦截 / `Ctrl+C`）会留下 `frontend/.next/lock`，再次构建直接报 `Another next build process is already running` 且不会自愈；`scripts/dev.ps1` 与 `scripts/dev.sh` 现在在 `npm run build` 前检查该锁——有存活的构建进程则明确提示并中止（避免双构建互相破坏产物），无存活进程则判定为残留并自动清理

## 2.0 — 2026-09-18

PhysLab 2.0：从「实验数据处理工具」升级为具备真实数据共建能力的实验 AI 平台。

### Added

- **AI 实验共建模式**：首页与实验库提供「普通实验」和「AI 实验共建」两个入口，进入同一个实验工作台（`?mode=collection`），不复制任何实验页面、不额外要求填写表单
- **OCR 数据采集闭环**：自愿上传 → 私有存储会话 → 报告成功后确认数据 → 切分为单数值训练样本 → 导出训练集
- **OpenCV 实验表格分割**：以本仓库渲染的标准记录表为模板，按稳定字段 ID 定位单元格并裁出单个手写数值，含配准校验、质量筛选与表格线清理
- **PhysLab_OCR 数据导出**：`python -m backend.ocr_dataset.export` 把已确认的共建会话打包成 `physlab_ocr_dataset.zip`（`dataset/{images,labels.csv,manifest.json}`），解压即可直接训练
- **数据贡献反馈**：上传后的贡献卡片（实验类型 / 保存状态 / 后续动作 / 预计生成样本数）与实验完成后的感谢弹窗，含「撤回本次贡献」
- **开发者统计面板**：`GET /api/data-collection/stats`（会话数、已确认数、样本数、按实验分布）与 `/dev/data-collection` 页面
- **实验文件**：每个实验的标准记录表、数据特征参考（典型数据形态）与报告模板
- **模块化实验架构**：Experiment Registry + 每个实验独立的 config/adapter，新增实验不再需要改动中央引擎

### Improved

- 用户上传体验：同屏完成同意 → 选图 → 上传，失败不影响实验功能；错误提示改为学生可读的措辞
- 实验工作流程：实验库可直接下载记录表，工作台一屏完成录入 → 校验 → 计算 → 绘图 → 导出
- 输入提示：每个字段的建议范围改为与记录表印刷量程一致（此前部分字段显示 ±10000 的无意义提示）

### Privacy

- 用户授权机制：只有明确勾选同意才会保存；未同意时接口直接拒绝，普通模式不产生任何会话
- 本地数据隔离：`backend/data_collection/`（原图、metadata、数据集）与 `.env.local` 全部被 `.gitignore` 排除，不进仓库
- 图片脱敏：保存前重新编码以去除拍摄时间、位置等照片信息；不记录 IP、浏览器指纹与账号信息
- 撤回即删除：删除会话原图、metadata，以及由它生成的数据样本

### Fixed

- 修复导出路径在零样本时的崩溃（空数据集现在也会生成合法的空压缩包）
- 修复宽单元格裁切被误判为空白、竖直表格线残影被并入裁切的问题
- 历史 `scripts/export_ocr_dataset.py` 现在接受数字字符串（`"22.090"` 不再被静默丢弃），且不再把整页图片复制出私有存储

## 2.0.0-beta.1 — 2026-09-16

- 统一实验 schema 与后端校验（warning-first 的期望范围）
- 合并 `photoelectric-franck-hertz` 目录条目，同时保留旧 ID 与路由
- OCR provider 边界（`RapidOCRProvider`，可选 `PaddleOCRProvider`）与单元格反馈存储
- 匿名分析、OCR 纠正指标、consent-first 的数据集导出脚本
- 保存报告、绘图、记录表与偏振光/声速光速专用工作台的兼容性
- 公开测试版提示条与反馈入口

## 更早

- 1.x：单实验计算工具，覆盖偏振光与声速光速实验
