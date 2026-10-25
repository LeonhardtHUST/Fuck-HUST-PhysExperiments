/**
 * Browser clipboard / download helpers for the artifact exchange UI.
 *
 * Falls back to a hidden textarea + `document.execCommand("copy")` because
 * several embedded browsers still refuse `navigator.clipboard` outside a
 * secure context. Returns booleans so callers can render inline feedback.
 */

function legacyCopy(text: string): boolean {
  if (typeof document === "undefined") return false;
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.top = "-1000px";
  area.style.opacity = "0";
  document.body.appendChild(area);
  area.select();
  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch (error) {
    console.error("execCommand copy failed", error);
    copied = false;
  }
  area.remove();
  return copied;
}

export async function copyText(text: string): Promise<boolean> {
  if (!text) return false;
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (error) {
      console.error("navigator.clipboard.writeText failed, falling back", error);
    }
  }
  return legacyCopy(text);
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function downloadText(
  filename: string,
  text: string,
  mime = "application/json;charset=utf-8"
): void {
  downloadBlob(new Blob([text], { type: mime }), filename);
}

/** Filesystem-safe fragment for generated filenames. */
export function safeFilePart(value: string): string {
  return value.replace(/[\\/:*?"<>|\s]+/g, "-").replace(/^-+|-+$/g, "") || "artifact";
}
