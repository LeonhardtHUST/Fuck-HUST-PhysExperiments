/**
 * 实验「来龙去脉 + 公式」的策展文本结构。
 *
 * 数据文件位于 `backend/experiments/<id>/prompt_context.json`，前端在
 * `experiment-contexts.ts` 中静态 import（与 config.json 同一模式）。
 * 这里只放类型，保证 artifact / prompt 构建器可以被 node 测试直接加载。
 */

export interface PromptMethodContext {
  /** 与 config.json 或子实验 id 完全一致。 */
  id: string;
  /** 简短标题，用于 Prompt 小标题。 */
  name?: string;
  /** 核心公式（LaTeX 或纯文本），逐条列出。 */
  formulas: string[];
  /** 判据 / 读数规则（如共振判据、消光判据）。 */
  criteria?: string[];
  /** 本方法的测量要点。 */
  tips?: string[];
  /** AI 允许填写的派生量（后端不会计算的中间量）。 */
  aiComputed?: { key: string; label: string; unit?: string; hint?: string }[];
}

export interface PromptContext {
  experimentId: string;
  /** 实验目的与来龙去脉，2–5 句。 */
  background: string;
  methods: PromptMethodContext[];
  /** 全实验通用的易错点 / 操作失误提示，供 AI 做误差分析参考。 */
  commonMistakes?: string[];
  /** 数据记录纸的版面说明（可选）。 */
  recordSheet?: string;
}
