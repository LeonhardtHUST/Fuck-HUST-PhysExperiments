/**
 * Dependency-free JSONC helpers.
 *
 * The workspace exchanges two dialects:
 *  - strict JSON for exported experiment data (machine readable, no comments),
 *  - JSONC for schemas / prompts shown to students and AI assistants.
 *
 * This module is deliberately free of React, aliases and server imports so
 * `node --experimental-strip-types --test` can load it directly.
 */

export class JsoncParseError extends Error {
  line: number;
  column: number;

  constructor(message: string, line: number, column: number) {
    super(message);
    this.name = "JsoncParseError";
    this.line = line;
    this.column = column;
  }
}

/** Removes one surrounding ```jsonc / ```json code fence produced by chat UIs. */
export function stripCodeFence(text: string): string {
  const trimmed = text.replace(/^\uFEFF/, "").trim();
  const fenced = /^```[^\n]*\r?\n([\s\S]*?)\r?\n?```$/.exec(trimmed);
  return fenced ? fenced[1] : trimmed;
}

/**
 * Replaces `//` and `/* *\/` comments with spaces (line breaks preserved) so
 * offsets in the result still line up with the original text for error hints.
 */
export function stripJsoncComments(input: string): string {
  const out = input.split("");
  let inString = false;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    const next = input[i + 1];

    if (lineComment) {
      if (char === "\n") lineComment = false;
      else out[i] = " ";
      continue;
    }
    if (blockComment) {
      if (char === "*" && next === "/") {
        out[i] = " ";
        out[i + 1] = " ";
        i += 1;
        blockComment = false;
      } else if (char !== "\n" && char !== "\r") {
        out[i] = " ";
      }
      continue;
    }
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === "/" && next === "/") {
      out[i] = " ";
      out[i + 1] = " ";
      lineComment = true;
      i += 1;
      continue;
    }
    if (char === "/" && next === "*") {
      out[i] = " ";
      out[i + 1] = " ";
      blockComment = true;
      i += 1;
    }
  }

  return out.join("");
}

/** Drops commas that directly precede `}` or `]` (JSONC trailing commas). */
export function removeTrailingCommas(input: string): string {
  const out = input.split("");
  let inString = false;
  let escaped = false;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char !== ",") continue;

    let cursor = i + 1;
    while (cursor < input.length && /\s/.test(input[cursor])) cursor += 1;
    if (input[cursor] === "}" || input[cursor] === "]") out[i] = " ";
  }

  return out.join("");
}

/** Normalises JSONC (fence + comments + trailing commas) into strict JSON text. */
export function normalizeJsonc(text: string): string {
  return removeTrailingCommas(stripJsoncComments(stripCodeFence(text)));
}

function positionToLineColumn(text: string, position: number): { line: number; column: number } {
  const limit = Math.max(0, Math.min(position, text.length));
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < limit; i += 1) {
    if (text[i] === "\n") {
      line += 1;
      lineStart = i + 1;
    }
  }
  return { line, column: limit - lineStart + 1 };
}

function describeJsonError(error: unknown, text: string): JsoncParseError {
  const raw = error instanceof Error ? error.message : String(error);
  const matched = /position (\d+)/i.exec(raw);
  const position = matched ? Number(matched[1]) : -1;
  const where = position >= 0 ? positionToLineColumn(text, position) : { line: 0, column: 0 };
  const hint =
    where.line > 0 ? `第 ${where.line} 行第 ${where.column} 列附近` : "文本中";
  return new JsoncParseError(`JSON/JSONC 解析失败：${hint}存在语法错误`, where.line, where.column);
}

/** Parses JSON or JSONC text; throws `JsoncParseError` with a line/column hint. */
export function parseJsonc<T = unknown>(text: string): T {
  const normalized = normalizeJsonc(text);
  if (!normalized.trim()) {
    throw new JsoncParseError("JSON/JSONC 解析失败：内容为空", 0, 0);
  }
  try {
    return JSON.parse(normalized) as T;
  } catch (error) {
    throw describeJsonError(error, normalized);
  }
}

export type JsoncResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string; line: number; column: number };

/** Non-throwing wrapper used by import panels. */
export function tryParseJsonc<T = unknown>(text: string): JsoncResult<T> {
  try {
    return { ok: true, value: parseJsonc<T>(text) };
  } catch (error) {
    const failure =
      error instanceof JsoncParseError
        ? error
        : new JsoncParseError("JSON/JSONC 解析失败：未知错误", 0, 0);
    return { ok: false, error: failure.message, line: failure.line, column: failure.column };
  }
}

/** Pretty-prints a value as strict JSON (used for exported data files). */
export function stringifyJson(value: unknown, indent = 2): string {
  return `${JSON.stringify(value, null, indent)}\n`;
}

/** Renders a comment line inside generated JSONC templates. */
export function jsoncComment(comment: string): string {
  return `// ${comment}`;
}
