// ================= CSV UTILITIES =================
// parseCSV(text)
//   Parses raw CSV text into structured data.
//   Returns { delimiter, headers, rows } where rows is string[][].
//   Handles: UTF-8 BOM, auto-delimiter detection (comma / semicolon / tab),
//   RFC 4180 quoted fields (embedded commas, newlines, escaped quotes).
//
// detectEffectType(headers, currentType, profiles)
//   Scores every effect profile against the CSV headers and returns the
//   best match along with confidence and column details.
//   Returns { type, confidence, matched, missing }.

// ---------------------------------------------------------------------------
// parseCSV
// ---------------------------------------------------------------------------

// Detect the most likely delimiter by counting candidates in the header line.
function detectDelimiter(firstLine) {
  const counts = {
    ",": (firstLine.match(/,/g)   || []).length,
    ";": (firstLine.match(/;/g)   || []).length,
    "\t": (firstLine.match(/\t/g) || []).length,
  };
  // Tab wins outright if present at all (avoids comma false-positives in
  // TSV files that also happen to have commas inside quoted fields).
  if (counts["\t"] > 0 && counts["\t"] >= counts[","]) return "\t";
  return counts[";"] > counts[","] ? ";" : ",";
}

// Minimal RFC 4180 state-machine parser.
// Quoted fields: opened and closed by `"`.
// Embedded `""` → literal `"`.
// Embedded delimiters and newlines inside quotes are preserved.
function parseFields(text, delim) {
  const rows   = [];
  let row      = [];
  let field    = "";
  let inQuotes = false;
  let i        = 0;

  while (i < text.length) {
    const ch   = text[i];
    const next = text[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        // Escaped quote
        field += '"';
        i += 2;
      } else if (ch === '"') {
        // Close quote
        inQuotes = false;
        i++;
      } else {
        field += ch;
        i++;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
        i++;
      } else if (ch === delim) {
        row.push(field.trim());
        field = "";
        i++;
      } else if (ch === "\r" && next === "\n") {
        row.push(field.trim());
        rows.push(row);
        row   = [];
        field = "";
        i += 2;
      } else if (ch === "\n") {
        row.push(field.trim());
        rows.push(row);
        row   = [];
        field = "";
        i++;
      } else {
        field += ch;
        i++;
      }
    }
  }

  // Flush the last field / row.
  if (inQuotes || field !== "" || row.length > 0) {
    row.push(field.trim());
    rows.push(row);
  }

  return rows;
}

export function parseCSV(text) {
  // Strip UTF-8 BOM written by Excel and some Windows tools.
  text = text.replace(/^\uFEFF/, "");

  // Detect delimiter from the first non-empty line.
  const firstLine = text.split(/\r?\n/).find(l => l.trim() !== "") ?? "";
  const delimiter = detectDelimiter(firstLine);

  const allRows = parseFields(text, delimiter)
    .filter(r => r.some(f => f !== ""));  // drop blank rows

  if (allRows.length === 0) {
    return { delimiter, headers: [], rows: [] };
  }

  const headers  = allRows[0];
  const colCount = headers.length;

  // Pad every data row to the header width so callers can safely use index
  // access without bounds checks.
  const rows = allRows.slice(1).map(r => {
    if (r.length >= colCount) return r.slice(0, colCount);
    return [...r, ...Array(colCount - r.length).fill("")];
  });

  return { delimiter, headers, rows };
}

// ---------------------------------------------------------------------------
// detectEffectType
// ---------------------------------------------------------------------------

// profiles is the effectProfiles map from ui.js, passed by the caller so
// this module stays independent of the DOM and application state.
export function detectEffectType(headers, currentType, profiles) {
  const lowerHeaders = new Set(headers.map(h => h.toLowerCase()));

  // Score every profile: proportion of its required inputs present in headers.
  const scored = Object.entries(profiles).map(([type, profile]) => {
    const required   = profile.inputs.map(i => i.toLowerCase());
    const matchCount = required.filter(c => lowerHeaders.has(c)).length;
    const score      = required.length > 0 ? matchCount / required.length : 0;
    return { type, score, inputCount: required.length };
  });

  const maxScore = Math.max(...scored.map(s => s.score));

  // Nothing matched — return current selection with "none" confidence.
  if (maxScore === 0) {
    const profile  = profiles[currentType];
    const required = profile ? profile.inputs.map(i => i.toLowerCase()) : [];
    return {
      type:       currentType,
      confidence: "none",
      matched:    [],
      missing:    required,
    };
  }

  // Among all tied top-scorers, apply priority:
  //   1. currentType (keeps the user's existing selection when ambiguous)
  //   2. Profile with the most required inputs (more specific match wins)
  //   3. First in definition order (stable fallback)
  const candidates = scored.filter(s => s.score === maxScore);

  const best =
    candidates.find(c => c.type === currentType) ??
    candidates.reduce((a, b) => b.inputCount > a.inputCount ? b : a);

  const profile  = profiles[best.type];
  const required = profile.inputs.map(i => i.toLowerCase());
  const matched  = required.filter(c => lowerHeaders.has(c));
  const missing  = required.filter(c => !lowerHeaders.has(c));

  return {
    type:       best.type,
    confidence: maxScore === 1 ? "full" : "partial",
    tied:       candidates.length > 1,
    tiedTypes:  candidates.map(c => c.type),
    matched,
    missing,
  };
}
