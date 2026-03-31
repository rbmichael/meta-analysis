// run_tests.mjs — Node.js entry point for js/tests.js
// Usage:  node run_tests.mjs
import { runTests } from "./js/tests.js";

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
process.exit(failed ? 1 : 0);
