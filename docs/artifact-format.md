# 实验数据 artifact 格式（schemaVersion 1）

工作台的「导出 / 导入 / Schema / AI Prompt」共用同一份文档结构：

- **导出**：严格 JSON（`JSON.stringify`，无注释、无尾随逗号），文件后缀 `.json`。
- **Schema**：同一结构的 JSONC 模板（`//` 与 `/* */` 注释、空 `rows`），用于交给 AI 填写。
- **导入**：容错 JSONC —— 允许注释、尾随逗号、Markdown 代码围栏（```` ```jsonc ```` / ```` ```json ````）。

解析与校验在纯前端完成（`frontend/src/lib/jsonc.ts`、`experiment-artifact.ts`），后端不读取该文件。

## 顶层结构

```jsonc
{
  "schemaVersion": 1,                    // 必须为 1，其他值直接报错
  "experiment": {
    "id": "michelson",                   // 必须与当前工作台一致，否则拒绝导入
    "name": "迈克尔逊干涉",
    "category": "optics"
  },
  "setupParams": {                       // 可选：实验级参数（偏振光的 bg_uw / theta_qwp 等）
    "bg_uw": 2.5
  },
  "tables": {
    "wavelength": {                      // tableId，与页面上的每张表一一对应
      "params": { "fringes_per_step": 50 },
      "rows": [
        { "fringe_count": 50, "position": 12.34567 }
      ],
      "remarks": {
        "status": "ok",                  // ok | incomplete | suspect
        "summary": "数据线性良好",
        "issues": [
          {
            "severity": "warning",       // info | warning | error（缺省按 info 处理）
            "row": 3,                    // 1 基行号，可选
            "column": "position",        // 列键，可选
            "message": "该行位移与相邻点不成等差",
            "suspectedCause": "鼓轮回程差或读数时条纹仍在移动"
          }
        ]
      }
    }
  },
  "remarks": {                           // 可选：实验级汇总
    "summary": "整体数据可用，第 3 组建议重测",
    "suspectedCauses": ["干涉仪台面轻微振动"],
    "issues": [
      { "severity": "error", "table": "wavelength", "row": 3, "message": "该组数据无法参与逐差" }
    ]
  },
  "computed": {                          // 可选：AI 给出的派生量（仅供参考）
    "planck.h": {
      "value": 6.62e-34,
      "label": "普朗克常数",
      "unit": "J·s",
      "source": "ai",
      "note": "由 5 个截止电压线性拟合得到"
    }
  }
}
```

## 字段语义

| 字段 | 说明 |
| --- | --- |
| `schemaVersion` | 文档版本，目前固定为 `1`；缺失或不支持时报错。 |
| `experiment.id` | 与工作台实验 id 相同；不匹配直接拒绝，避免把 A 实验的数据写进 B。 |
| `tables` | 键为 `tableId`。通用实验 = 方法 id；声光 = `方法id-表序号`（如 `light_sine-1`）；偏振光 = `malus` / `halfwave` / `quarterwave` / `circular`。 |
| `tables.*.params` | 表级参数（该方法的工作参数 / 初始读数），键取自 Schema。 |
| `tables.*.rows` | 行对象数组，键为列键。空单元格写 `null` 或直接省略。 |
| `tables.*.rows[].<只读角度列>` | 可省略：导入时按行序列重建（马吕斯 90° 递减 10°，其余 0° 递增 10°；声光的「序号」列自动编号）。 |
| `remarks.status` | `ok`（数据完整）/ `incomplete`（缺项）/ `suspect`（可疑）。 |
| `remarks.issues[].row` | **1 基**行号，对应文件 `rows` 数组中的第几条记录。 |
| `remarks.issues[].column` | 列键（不是中文表头），前端会翻译成表头文字。 |
| `remarks.suspectedCauses` | 仅实验级：可能的操作失误 / 误差来源列表。 |
| `computed` | 键为 `方法id.结果键`（声光/偏振光为 `结果键`）。仅允许 `source: "ai"`。 |

## computed 的来源约束

- `source: "backend"` 的条目**不会**被接受：后端会重新计算这些结果，导入时只保留 `source: "ai"` 的派生量，并在导入警告中提示。
- 前端把 `source: "ai"` 的条目以虚线卡片标注为「AI 参考值 · 非提交结果」，不参与提交与报告。
- Prompt 中列出的「禁止填写」字段即后端结果字段（如 `h`、`wavelength`、`thermal_conductivity` 等），AI 不应写入。

## 导入容错规则

1. 文本上限 1,000,000 字符；单表上限 500 行，超出部分被截断并给出警告。
2. 未知 `tableId` / 未知列 / 未知参数：忽略并降级为警告，不影响其余表导入。
3. 字符串数值：数字列自动强转，无法转换时保留字符串并在提交时由后端校验。
4. 备注文本：折叠空白，单条最多 600 字符，问题最多 50 条，`severity` 非法时按 `info` 处理。
5. 覆盖语义：文件中出现的表按内容重建；未出现的表保持界面原样；导入前需二次确认。
6. 导入成功后清空该实验/该类方法的旧计算结果（需要重新计算）。

## 单表与整实验

- **整实验**：`tables` 含全部表，可用于备份与恢复整次实验。
- **单表**：文件只含一张表（`tables` 仅一个键），Schema 与 Prompt 也只描述这张表；把整实验文件粘到单表入口时，只取对应的那张表。

## 与 AI 的协作流程

1. 在工作台顶部点「复制 AI Prompt」（或单表的「Schema」）。
2. 把 Prompt 与记录纸照片一起交给其他 AI 会话，要求它输出**一个 `jsonc` 代码块**。
3. 把返回内容粘贴到「导入实验数据 / 导入此表」，解析预览确认后导入。
4. AI 的备注与问题会显示在表格下方与工作台顶部，可一键清除。
