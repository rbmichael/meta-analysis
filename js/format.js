// =============================================================================
// format.js — Shared formatting helpers (plain-text output)
// =============================================================================
// All functions return plain text. Callers that build HTML must apply escHTML()
// to any output that may contain '<' (fmtP, fmtP_APA). OOXML callers (docx.js)
// use the plain-text values directly; xmlEsc() handles XML escaping downstream.
//
// Exports
// -------
//   fmt(v, d)           — fixed-precision number or em-dash for non-finite
//   fmtP(p)             — 4-decimal p-value; "<0.0001" for very small p
//   fmtP_APA(p)         — APA 7th-ed p: "= .043" / "< .001" / em-dash
//   fmtCI_APA(lo,hi,d)  — "[x.xxx, x.xxx]"
//   escHTML(s)          — HTML-escape a string for safe innerHTML insertion
// =============================================================================

export function fmt(v, d = 3) {
  return isFinite(v) ? (+v).toFixed(d) : "—";
}

export function fmtP(p) {
  if (!isFinite(p)) return "—";
  if (p < 0.0001)   return "<0.0001";
  return (+p).toFixed(4);
}

// APA 7th edition p-value: no leading zero, three decimal places.
export function fmtP_APA(p) {
  if (!isFinite(p)) return "—";
  if (p < 0.001)    return "< .001";
  return "= " + (+p).toFixed(3).replace(/^0\./, ".");
}

// APA CI string: "[x.xxx, x.xxx]"
export function fmtCI_APA(lo, hi, d = 3) {
  return `[${fmt(lo, d)}, ${fmt(hi, d)}]`;
}

export function escHTML(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
