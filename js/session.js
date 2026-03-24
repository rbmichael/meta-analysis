// ================= SESSION SCHEMA =================
// Single source of truth for the session file format.
//
// Schema (version 1):
//   version       — integer, bumped on breaking changes
//   settings      — the six UI controls that govern analysis behaviour
//   moderators    — array of { name, type } objects
//   studies       — array of { study, inputs: {col: value}, group, moderators: {name: value} }

export const SESSION_VERSION = 1;

// Build a versioned session object from explicit plain-JS arguments.
// settings       — { effectType, tauMethod, ciMethod, cumulativeOrder, useTrimFill, useTFAdjusted }
// savedModerators — array of { name, type }
// studies        — array of { study, inputs, group, moderators }
export function buildSession(settings, savedModerators, studies) {
  return { version: SESSION_VERSION, settings, moderators: savedModerators, studies };
}

// Serialize a session object to a BOM-prefixed JSON string.
export function serializeSession(session) {
  return "\uFEFF" + JSON.stringify(session, null, 2);
}

// Parse and validate a session file's text content.
// Returns { ok: true, session } on success, or { ok: false, error } on failure.
// Strips a leading BOM if present before parsing.
export function parseSession(text) {
  let raw;
  try {
    raw = JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch {
    return { ok: false, error: "Session file is not valid JSON." };
  }

  if (typeof raw.version !== "number")
    return { ok: false, error: "Session file is missing a version field." };
  if (raw.version > SESSION_VERSION)
    return { ok: false, error: `Unsupported session version (${raw.version}).` };

  return { ok: true, session: raw };
}

// Return the subset of inputCols that are entirely absent from savedStudies.
// Used to warn the user when a loaded session was saved under a different effect type.
export function missingInputCols(inputCols, savedStudies) {
  if (!savedStudies.length) return [];
  return inputCols.filter(col => savedStudies.every(r => r.inputs?.[col] === undefined));
}
