// ================= AUTOSAVE =================
// Persists the current session state to localStorage so the app can
// recover from accidental tab/browser closure.
//
// The draft payload is a standard session object (same schema as session.js)
// with one extra field:
//   _savedAt — Unix timestamp (ms) recorded at write time.
//
// All public functions are safe to call unconditionally: errors from a full
// or unavailable storage are caught and silently ignored.

import { SESSION_VERSION } from "./session.js";

export const DRAFT_KEY = "meta-analysis-draft";

// Write sessionObj to localStorage, stamping _savedAt with the current time.
export function saveDraft(sessionObj) {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...sessionObj, _savedAt: Date.now() }));
  } catch {
    // localStorage full or unavailable — fail silently.
  }
}

// Read and validate the stored draft.
// Returns the parsed session object (including _savedAt) on success,
// or null if nothing is stored, the entry is corrupt, or the version is
// incompatible.  A corrupt or incompatible entry is removed automatically.
export function loadDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw);

    if (typeof parsed.version !== "number" || parsed.version > SESSION_VERSION) {
      clearDraft();
      return null;
    }

    return parsed;
  } catch {
    clearDraft();
    return null;
  }
}

// Remove the stored draft.
export function clearDraft() {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    // Ignore.
  }
}
