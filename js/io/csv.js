// =============================================================================
// csv.js — CSV parsing and effect-type auto-detection
// =============================================================================
// Handles all CSV import logic: delimiter sniffing, RFC 4180 field parsing,
// header normalisation, and heuristic matching of column names to effect-type
// profiles.
//
// Exports
// -------
//   parseCSV(text)
//     Parses raw CSV text into structured data.
//     Returns { delimiter, headers, rows } where rows is string[][].
//     Handles: UTF-8 BOM, auto-delimiter detection (comma / semicolon / tab),
//     RFC 4180 quoted fields (embedded commas, newlines, escaped quotes).
//
//   detectEffectType(headers, currentType, profiles)
//     Scores every effect profile against the CSV headers and returns the
//     best-matching effect type.
//     Returns { type, confidence, matched, missing }.
//
// Dependencies
// ------------
//   profiles.js  (effectProfiles — passed in as `profiles` argument)

// ---------------------------------------------------------------------------
// parseNumberWithDecimal
// ---------------------------------------------------------------------------

// Parse a numeric string, treating `decimal` as the decimal separator.
// When decimal is "," the pattern ^[+-]?\d+,\d+…$ is normalised to dot-form
// before parseFloat; all other strings pass through unchanged.
export function parseNumberWithDecimal(s, decimal) {
  if (typeof s !== "string") return parseFloat(s);
  const norm = decimal === ","
    ? s.replace(/^([+-]?\d+),(\d+(?:[eE][+-]?\d+)?)$/, "$1.$2")
    : s;
  return parseFloat(norm);
}

// Normalise a single CSV cell value when the file uses comma as decimal separator.
// Only cells that are unambiguously numeric (sign? digits comma digits opt-exp) are
// touched; labels, study names, and empty strings pass through unchanged.
function normalizeCell(s, decimal) {
  if (decimal !== ",") return s;
  return s.replace(/^([+-]?\d+),(\d+(?:[eE][+-]?\d+)?)$/, "$1.$2");
}

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

// Detect CSV format (delimiter + decimal separator) from the full file text.
// Returns { delimiter, decimal, confidence } where confidence is 'high' | 'medium' | 'low'.
// Uses RFC-4180 tokenisation for decimal analysis to avoid false positives from
// commas embedded inside quoted fields.
export function detectCsvFormat(text) {
  text = text.replace(/^\uFEFF/, "");

  const lines = text.split(/\r?\n/).filter(l => l.trim() !== "").slice(0, 100);
  if (lines.length === 0) return { delimiter: ",", decimal: ".", confidence: "low" };

  // Count each candidate delimiter, skipping characters inside quoted fields.
  const candidates = [",", ";", "\t", "|"];
  const totals = Object.fromEntries(candidates.map(d => [d, 0]));
  for (const line of lines) {
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { inQ = !inQ; continue; }
      if (!inQ && totals[ch] !== undefined) totals[ch]++;
    }
  }

  // Tab wins outright if present; otherwise pick the highest count.
  let delimiter;
  if (totals["\t"] > 0) {
    delimiter = "\t";
  } else {
    delimiter = [";", "|", ","].reduce(
      (best, d) => totals[d] > totals[best] ? d : best, ","
    );
  }

  // Tokenise with the chosen delimiter (RFC-4180) to get clean cell values.
  const allRows = parseFields(text, delimiter).filter(r => r.some(f => f !== "")).slice(0, 101);
  if (allRows.length < 2) {
    return { delimiter, decimal: delimiter === ";" ? "," : ".", confidence: "low" };
  }

  const dataRows = allRows.slice(1);
  const colCount = allRows[0].length;

  // For each column that is \u2265 80 % numeric-looking, tally dot- vs comma-decimal cells.
  // A numeric-looking cell matches ^[+-]?\d+([.,]\d+)?([eE][+-]?\d+)?$
  const numRe = /^[+-]?\d+([.,]\d+)?([eE][+-]?\d+)?$/;
  let dotCols = 0, commaCols = 0;

  for (let col = 0; col < colCount; col++) {
    const cells = dataRows.map(r => (r[col] ?? "").trim()).filter(Boolean);
    if (cells.length === 0) continue;
    const numeric = cells.filter(c => numRe.test(c));
    if (numeric.length / cells.length < 0.8) continue;

    let dots = 0, commas = 0;
    for (const c of numeric) {
      if (/\.\d/.test(c)) dots++;
      else if (/,\d/.test(c)) commas++;
    }
    if (dots === 0 && commas === 0) continue; // integer column \u2014 uninformative
    if (dots > 0 && commas === 0) dotCols++;
    else if (commas > 0 && dots === 0) commaCols++;
    // Mixed within a single column: skip as inconsistent
  }

  // Decision rules (see Plan A.5 edge cases).
  let decimal, confidence;

  if (dotCols > 0 && commaCols === 0) {
    decimal = ".";
    // US locale (comma or tab delimiter) is unambiguous; semicolon-with-dot is unusual.
    confidence = (delimiter === "," || delimiter === "\t" || delimiter === "|") ? "high" : "medium";
  } else if (commaCols > 0 && dotCols === 0) {
    decimal = ",";
    if (delimiter === ";") {
      confidence = "high"; // classic EU locale: semicolon delimiter + comma decimal
    } else if (delimiter === "\t" || delimiter === "|") {
      confidence = "high"; // tab/pipe + comma decimal \u2014 EU variant
    } else {
      // delimiter "," and decimal "," conflict \u2014 default to dot, emit warning via low confidence
      decimal = ".";
      confidence = "low";
    }
  } else {
    // No fractional columns detected, or conflicting signals \u2014 safe US default.
    decimal = ".";
    confidence = "low";
  }

  // Single-column files: delimiter selection was arbitrary, downgrade confidence.
  if (colCount <= 1) {
    if (confidence === "high") confidence = "medium";
  }

  return { delimiter, decimal, confidence };
}

export function parseCSV(text, opts = {}) {
  // Strip UTF-8 BOM written by Excel and some Windows tools.
  text = text.replace(/^\uFEFF/, "");

  // Caller may supply an explicit delimiter (e.g. from the import-preview dropdowns).
  const firstLine = text.split(/\r?\n/).find(l => l.trim() !== "") ?? "";
  const delimiter = opts.delimiter ?? detectDelimiter(firstLine);

  const allRows = parseFields(text, delimiter)
    .filter(r => r.some(f => f !== ""));  // drop blank rows

  if (allRows.length === 0) {
    return { delimiter, headers: [], rows: [] };
  }

  const headers  = allRows[0];
  const colCount = headers.length;

  // Pad every data row to the header width so callers can safely use index
  // access without bounds checks.
  const { decimal } = opts;
  const rows = allRows.slice(1).map(r => {
    const padded = r.length >= colCount ? r.slice(0, colCount)
                                        : [...r, ...Array(colCount - r.length).fill("")];
    return decimal === "," ? padded.map(cell => normalizeCell(cell, decimal)) : padded;
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
