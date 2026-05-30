// audit_match_comments.mjs
// Phase 6 guard: flag any "match app/JS" comment in R sources that lacks an AUDITED: tag.
//
// Convention:
//   When a generate.R block uses custom R code (instead of a metafor default call) to
//   produce values that match the JS app, the comment must be followed within WINDOW
//   lines by:
//     # AUDITED: <reason> (YYYY-MM-DD); <canonical-side>; see benchmark-data.md §<section>
//
//   Files marked with  # AUDIT_EXEMPT: ...  in the first HEADER_LINES lines are skipped
//   entirely (used for comparisons/*.R, which are cross-validation scripts by design).
//
// Usage:  node audit_match_comments.mjs
// Exit:   0 = clean; 1 = violations found

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT   = fileURLToPath(new URL(".", import.meta.url));
const WINDOW = 4;          // lines after the match line to look for AUDITED:
const HEADER = 15;         // lines at the top of file to check for AUDIT_EXEMPT:

// Pattern that flags a "match app/JS" comment in R code.
// Captures: "match(ing) the app", "match(ing) JS", "app's value/formula/convention/output".
const MATCH_PAT = /match(?:ing)?\s+(?:the\s+)?(?:app|JS)\b|app'?s\s+(?:value|formula|convention|output)/i;

// An AUDITED: tag on the same line or within WINDOW lines after a flagged comment.
const AUDITED_PAT = /AUDITED:/i;

// A file-level exemption marker in the first HEADER lines.
const EXEMPT_PAT = /AUDIT_EXEMPT:/i;

// Collect target files: generate.R + comparisons/*.R
function collectFiles() {
  const files = [ join(ROOT, "generate.R") ];
  const cmpDir = join(ROOT, "comparisons");
  try {
    for (const f of readdirSync(cmpDir)) {
      if (f.endsWith(".R")) files.push(join(cmpDir, f));
    }
  } catch { /* comparisons/ absent — skip */ }
  return files;
}

function checkFile(filepath) {
  let src;
  try { src = readFileSync(filepath, "utf8"); }
  catch { return []; }

  const lines   = src.split("\n");
  const relPath = relative(ROOT, filepath).replace(/\\/g, "/");

  // Skip file-level exempt files
  const header = lines.slice(0, Math.min(HEADER, lines.length));
  if (header.some(l => EXEMPT_PAT.test(l))) return [];

  const violations = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Only flag lines that are R comments (start with optional whitespace + #)
    if (!MATCH_PAT.test(line)) continue;
    if (!/^\s*#/.test(line))   continue;   // not a comment line — skip

    // Look for AUDITED: on the matched line or in the next WINDOW lines
    const window = lines.slice(i, Math.min(i + WINDOW + 1, lines.length));
    if (!window.some(l => AUDITED_PAT.test(l))) {
      violations.push({
        file: relPath,
        line: i + 1,
        text: line.trim().slice(0, 120),
      });
    }
  }
  return violations;
}

const files      = collectFiles();
const violations = files.flatMap(checkFile);

if (violations.length === 0) {
  console.log("✅ audit_match_comments: all match-app comments have AUDITED: tags");
  process.exit(0);
} else {
  console.log(`❌ audit_match_comments: ${violations.length} unaudited match-app comment(s)\n`);
  for (const v of violations) {
    console.log(`  ${v.file}:${v.line}`);
    console.log(`    ${v.text}`);
  }
  console.log(`
Each flagged comment must be followed within ${WINDOW} lines by:
  # AUDITED: <reason> (YYYY-MM-DD); <which-side-is-canonical>; see benchmark-data.md §<section>

Files marked  # AUDIT_EXEMPT:  in the first ${HEADER} lines are skipped entirely.
`);
  process.exit(1);
}
