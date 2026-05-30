// run_tests.mjs — Node.js entry point for js/tests.js
// Usage:  node run_tests.mjs
import { runTests } from "./js/tests.js";
import { runPlotTests } from "./js/test-harness/run-plot-tests.mjs";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

let failed = false;
const origLog = console.log.bind(console);
console.log = (...args) => {
  const msg = args.join(" ");
  origLog(...args);
  if (msg.includes("FAIL") && !msg.includes("PASSED") && !msg.includes("FAILED →")) {
    // Check if it's an actual failure line (contains "→ FAIL" or "❌")
    if (msg.includes("→ FAIL") || msg.includes("❌")) failed = true;
  }
};

runTests();

// ===== WORKER SYNC CHECKS =====
// Verify that constants and PRNG code in worker files match their upstream
// source modules.  Workers are intentionally self-contained (no ES imports),
// so this catches silent drift when upstream logic changes.
{
  origLog("\n===== WORKER SYNC CHECKS =====\n");
  let syncPass = true;
  const onFail = () => { syncPass = false; failed = true; };
  const chk = (label, ok) => {
    origLog(`  ${label}: ${ok ? "PASS" : "FAIL"}`);
    if (!ok) onFail();
  };

  const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");
  const goshJs     = read("./js/gosh.js");
  const goshWorker = read("./js/gosh.worker.js");
  const permJs     = read("./js/perm.js");
  const permWorker = read("./js/perm.worker.js");

  // Extract the numeric value of a named constant from source text.
  // Handles both `50_000` and `50000` forms.
  const extractConst = (src, name) => {
    const m = src.match(new RegExp(`${name}\\s*=\\s*([\\d_]+)`));
    return m ? Number(m[1].replace(/_/g, "")) : null;
  };

  // GOSH constants must match between gosh.js and gosh.worker.js
  for (const name of ["GOSH_MAX_ENUM_K", "GOSH_MAX_K", "GOSH_DEFAULT_MAX_SUBSETS"]) {
    const a = extractConst(goshJs, name);
    const b = extractConst(goshWorker, name);
    chk(`gosh.worker ${name} (${b}) matches gosh.js (${a})`, a !== null && b !== null && a === b);
  }

  // Mulberry32 PRNG magic constant must appear in all four files
  const magic = "0x6D2B79F5";
  chk("mulberry32 magic in gosh.js",      goshJs.includes(magic));
  chk("mulberry32 magic in gosh.worker",  goshWorker.includes(magic));
  chk("mulberry32 magic in perm.js",      permJs.includes(magic));
  chk("mulberry32 magic in perm.worker",  permWorker.includes(magic));

  // perm.js delegates tol/maxIter to tau2Core_* (tau2.js); worker still owns them explicitly
  chk("perm.js imports tau2Core_REML from tau2.js",  permJs.includes("tau2Core_REML"));
  chk("perm.worker.js TOL = 1e-10 present",          permWorker.includes("TOL = 1e-10"));
  chk("perm.worker.js MAX_ITER = 100 present",        permWorker.includes("MAX_ITER = 100"));

  // estimateTau2 must dispatch the same method names in the same order in both perm files
  const methods = ["REML", "ML", "PM", "HS", "HE"];
  const methodOrder = (src) => {
    const start = src.indexOf("function estimateTau2");
    const section = src.slice(start, start + 600);
    return methods.filter(m => section.includes(`'${m}'`));
  };
  const pmOrder = methodOrder(permJs);
  const pwOrder = methodOrder(permWorker);
  chk(
    `estimateTau2 dispatch order matches (${pmOrder.join(",")})`,
    pmOrder.length === methods.length && pmOrder.every((m, i) => m === pwOrder[i])
  );

  origLog(syncPass ? "\n✅ ALL WORKER SYNC CHECKS PASSED" : "\n❌ SOME WORKER SYNC CHECKS FAILED");
}

// ===== AUDIT: MATCH-APP COMMENTS =====
// Phase 6 guard: every "match app/JS" comment in generate.R must have an AUDITED: tag.
// comparisons/*.R are exempt (they are cross-validation scripts by design).
{
  origLog("\n===== AUDIT: MATCH-APP COMMENTS =====\n");

  const ROOT       = fileURLToPath(new URL(".", import.meta.url));
  const WINDOW     = 4;
  const HEADER     = 15;
  const MATCH_PAT  = /match(?:ing)?\s+(?:the\s+)?(?:app|JS)\b|app'?s\s+(?:value|formula|convention|output)/i;
  const AUDITED_P  = /AUDITED:/i;
  const EXEMPT_P   = /AUDIT_EXEMPT:/i;

  function auditFile(filepath) {
    let src;
    try { src = readFileSync(filepath, "utf8"); } catch { return []; }
    const lines  = src.split("\n");
    if (lines.slice(0, Math.min(HEADER, lines.length)).some(l => EXEMPT_P.test(l))) return [];
    const viols = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!MATCH_PAT.test(line) || !/^\s*#/.test(line)) continue;
      const win = lines.slice(i, Math.min(i + WINDOW + 1, lines.length));
      if (!win.some(l => AUDITED_P.test(l)))
        viols.push({ file: relative(ROOT, filepath).replace(/\\/g, "/"), line: i + 1, text: line.trim().slice(0, 100) });
    }
    return viols;
  }

  const targets = [ join(ROOT, "generate.R") ];
  try { for (const f of readdirSync(join(ROOT, "comparisons")))
    if (f.endsWith(".R")) targets.push(join(ROOT, "comparisons", f)); } catch {}

  const viols = targets.flatMap(auditFile);
  if (viols.length === 0) {
    origLog("  ✅ All match-app comments have AUDITED: tags");
  } else {
    origLog(`  ❌ ${viols.length} unaudited match-app comment(s):`);
    for (const v of viols) origLog(`    ${v.file}:${v.line}  ${v.text}`);
    failed = true;
  }
}

// ===== PLOT SMOKE TESTS =====
{
  origLog("\n===== PLOT SMOKE TESTS =====\n");
  const { fail: plotFail } = runPlotTests();
  if (plotFail > 0) failed = true;
}

process.exit(failed ? 1 : 0);
