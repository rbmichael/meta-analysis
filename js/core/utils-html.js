// =============================================================================
// utils-html.js — HTML string utilities (no imports, no DOM access)
//
// Leaf module: safe to import from any other module without circular risk.
// =============================================================================

export function escapeHTML(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
