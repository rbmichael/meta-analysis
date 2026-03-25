// =============================================================================
// forestThemes.js — Visual style presets for the forest plot
// =============================================================================
// Each theme is a flat object covering every colour, font, and stroke-weight
// decision made by drawForest().  Keeping these values here — rather than
// scattered across plots.js — means adding a new preset requires only a new
// entry in FOREST_THEMES; the renderer never needs to change.
//
// Usage in drawForest()
// ---------------------
//   import { FOREST_THEMES } from "./forestThemes.js";
//   const T = FOREST_THEMES[options.theme] ?? FOREST_THEMES["default"];
//   // Then replace every "var(--xxx)" with T.fieldName.
//
// Theme field reference
// ---------------------
//   bg              SVG background fill injected as a <rect> behind all content.
//                   Use "transparent" for the app-default (page CSS provides it).
//   fg              Study labels; primary text.
//   fgMuted         Header labels, axis text, title, heterogeneity line.
//   fgSubtle        CI lines (non-imputed), per-study annotation text.
//   accent          RE diamond fill + stroke; weight box fill + stroke.
//   accentFE        FE diamond fill + stroke; FE annotation text.
//   accentREAnnot   RE annotation text in the right column (effect + CI).
//                   In the app default this is --color-warning (amber).
//                   Journal presets use the same colour as `accent`.
//   pi              Prediction interval line, end-caps, and label text.
//   border          Header rule; vertical column separators.
//   groupSepStroke  Group-boundary horizontal rule.
//   groupLabelFill  Group-boundary label text.
//   fontFamily      Applied via style("font-family") to every text element.
//                   Use "inherit" for the app default (picks up page CSS).
//   ciStrokeWidth   Stroke width (px) for individual study CI lines.
//   headerRuleWidth Stroke width (px) for the horizontal header rule.
//   nullLineDash    stroke-dasharray string for the vertical null reference line.
// =============================================================================

export const FOREST_THEMES = {

  // ---------------------------------------------------------------------------
  // App default — reads CSS custom properties so the plot adapts automatically
  // to the light/dark theme switch.  Exported SVGs rendered with this preset
  // will contain unresolved var(--xxx) references; use a journal preset for
  // self-contained exports.
  // ---------------------------------------------------------------------------
  "default": {
    label:           "App default",
    bg:              "transparent",

    fg:              "var(--fg)",
    fgMuted:         "var(--fg-muted)",
    fgSubtle:        "var(--fg-subtle)",

    accent:          "var(--accent)",
    accentFE:        "var(--fg-muted)",
    accentREAnnot:   "var(--color-warning)",
    pi:              "var(--accent-light)",

    border:          "var(--border-hover)",
    groupSepStroke:  "var(--border-accent)",
    groupLabelFill:  "var(--color-info)",

    fontFamily:      "inherit",
    ciStrokeWidth:   1.5,
    headerRuleWidth: 1,
    nullLineDash:    "4",
  },

  // ---------------------------------------------------------------------------
  // Cochrane — matches the visual language of Cochrane Reviews and RevMan.
  // White background, Times New Roman, strict two-tone greyscale (near-black
  // for data, mid-grey for structural chrome and the FE diamond).
  // Reference: Cochrane Handbook §I.2; RevMan 5 default output.
  // ---------------------------------------------------------------------------
  "cochrane": {
    label:           "Cochrane",
    bg:              "#ffffff",

    fg:              "#1a1a1a",
    fgMuted:         "#666666",
    fgSubtle:        "#333333",

    accent:          "#1a1a1a",   // RE diamond and weight boxes: near-black
    accentFE:        "#767676",   // FE diamond: medium grey (visually distinct)
    accentREAnnot:   "#1a1a1a",   // RE annotation: same as primary text
    pi:              "#767676",   // PI bracket: same grey as FE

    border:          "#cccccc",   // Thin light-grey rules (header, separators)
    groupSepStroke:  "#333333",
    groupLabelFill:  "#1a1a1a",

    fontFamily:      "'Times New Roman', Times, serif",
    ciStrokeWidth:   1.5,
    headerRuleWidth: 1,
    nullLineDash:    "4",
  },

  // ---------------------------------------------------------------------------
  // JAMA — matches the visual language of JAMA and most North American clinical
  // journals (NEJM, Annals, BMJ).  White background, Arial, near-black for all
  // data elements, lighter grey for chrome.
  // Reference: JAMA author instructions; JAMA Network figure guidelines.
  // ---------------------------------------------------------------------------
  "jama": {
    label:           "JAMA",
    bg:              "#ffffff",

    fg:              "#1a1a1a",
    fgMuted:         "#555555",
    fgSubtle:        "#2d2d2d",

    accent:          "#1a1a1a",   // RE diamond and boxes: near-black
    accentFE:        "#888888",   // FE diamond: medium grey
    accentREAnnot:   "#1a1a1a",
    pi:              "#666666",

    border:          "#d0d0d0",   // Slightly lighter rules than Cochrane
    groupSepStroke:  "#444444",
    groupLabelFill:  "#1a1a1a",

    fontFamily:      "Arial, Helvetica, sans-serif",
    ciStrokeWidth:   1.5,
    headerRuleWidth: 1,
    nullLineDash:    "4",
  },

  // ---------------------------------------------------------------------------
  // Black & white — strict monochrome for journals that prohibit colour and
  // grey shading in figures.  All data and chrome elements use pure black;
  // structural rules use dark grey so they remain visually subordinate.
  // Both FE and RE diamonds are black (no tonal differentiation).
  // ---------------------------------------------------------------------------
  "bw": {
    label:           "Black & white",
    bg:              "#ffffff",

    fg:              "#000000",
    fgMuted:         "#000000",
    fgSubtle:        "#000000",

    accent:          "#000000",
    accentFE:        "#000000",   // FE and RE identical in monochrome
    accentREAnnot:   "#000000",
    pi:              "#000000",

    border:          "#333333",   // Dark grey keeps rules visible without heavy ink
    groupSepStroke:  "#000000",
    groupLabelFill:  "#000000",

    fontFamily:      "Arial, Helvetica, sans-serif",
    ciStrokeWidth:   1,           // Slightly thinner lines for print legibility
    headerRuleWidth: 1,
    nullLineDash:    "4",
  },

};

// Ordered list of keys for populating the UI dropdown.
// The "default" entry is always first; the rest are alphabetical by label.
export const FOREST_THEME_ORDER = ["default", "cochrane", "jama", "bw"];
