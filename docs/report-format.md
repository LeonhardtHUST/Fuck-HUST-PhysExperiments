# 完整报告导出格式

「完整报告」指包含数据表、拟合图与四部分分析的整份报告，同一份内容可导出四种格式：

| `fmt` | 产物 | 用途 |
|---|---|---|
| `docx` | Word 文档 | 交作业、继续排版 |
| `pdf` | PDF 文档 | 直接打印/提交 |
| `md` | Markdown 单文件 | 纯文本审阅、diff、喂给其他工具；图片以 data URI 内嵌，文件自包含 |
| `jsonc` | JSONC 文档 | 机器处理、二次排版、程序化校验（schema 见 `docs/schemas/report.schema.json`） |

四种格式由同一个块列表（`experiments/report_layout.py` 的 `four_section_report`）生成，内容不会各写一份。

## 调用方式

HTTP（三个报告路由都支持全部四种格式）：

```bash
curl -X POST "http://localhost:8001/api/experiments/michelson/report?fmt=jsonc" \
  -H "Content-Type: application/json" \
  -d '{"data": { ... }}' -o michelson.jsonc
```

MCP：

```python
generate_experiment_report(experiment_id="michelson", data={...}, fmt="md")
```

`fmt` 取值只接受上表四种，其他值返回 400（MCP 抛 `ToolInputError`）。缺少必做子实验时报告仍会生成，缺项在正文里标注并留空。

## JSONC 文档结构

文件头是若干 `//` 注释行（说明 schemaVersion 与 schema 路径），删掉这些行后就是合法 JSON：

```jsonc
// PhysicsLab 完整报告（JSONC）
// schemaVersion: 1 · schema: docs/schemas/report.schema.json
// 删除注释行后即为合法 JSON；content 按文档顺序排列。
{
  "schemaVersion": 1,
  "kind": "physlab.report",
  "generator": "PhysicsLab",
  "generatedAt": "2026-10-25T08:30:00Z",
  "experiment": { "id": "michelson", "name": "迈克尔逊干涉实验" },
  "title": "迈克尔逊干涉实验 · 完整报告",
  "content": [
    { "kind": "h3", "text": "表 1　测量数据" },
    { "kind": "table", "rows": [["测量次数", "d (mm)"], ["1", "0.123456"]] },
    { "kind": "pageBreak" },
    { "kind": "figure", "mime": "image/png", "base64": "iVBORw0..." },
    { "kind": "equation", "latex": "\\lambda = \\frac{2 \\Delta d}{N}" }
  ]
}
```

- `schemaVersion`：报告文档结构版本，目前为 `1`，字段或块类型不兼容变更时递增。
- `content`：按阅读顺序排列的块，纯排版块（`spacer`）已剔除，分页符变成 `pageBreak`。
- 表格的 `rows[0]` 是表头，所有行列已补齐为空字符串，单元格是纯文本（不保留 Word 的加粗、字号）。
- 图片是裸 base64（不带 `data:` 前缀），`mime` 目前只出现 `image/png`。
- 公式是 LaTeX 源码，不含 `$$` 定界符。

块类型、必填字段与枚举值都以 [`docs/schemas/report.schema.json`](schemas/report.schema.json) 为准（JSON Schema 2020-12）。仓库的 `backend/tests/test_report_export.py` 会解析该 schema，确认导出实际出现的块类型都被 schema 声明过。

## Markdown 约定

- 文档开头有一行 HTML 注释记录 `schemaVersion` / `experiment` / `generatedAt`，渲染时不可见。
- `h1`/`h2`/`h3` → 对应级别标题；第一个块不是 `h1` 时补一个 `# <title>`。
- 表格按 GFM 管道表格输出，单元格里的 `|` 转义为 `\|`，换行转成 `<br>`。
- 公式用 `$$ ... $$` 包裹；`note` 输出为引用块；`ruledLines` 输出为「此处留白 N 行」的引用。
- 图片输出为 `![说明](data:image/png;base64,...)`，因此含多张拟合图的 `.md` 会有数百 KB；不需要图时用 `jsonc` 或从 `content` 里自行取用。
- 分页符输出为 `---`，仅作分段提示，不保证任何渲染器都分页。

## 相关文件

- 生成逻辑：`backend/experiments/core/report_export.py`
- 路由：`backend/app/routers/reports.py`
- schema：`docs/schemas/report.schema.json`
