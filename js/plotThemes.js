// =============================================================================
// plotThemes.js — Visual style presets for all plots
// =============================================================================
// Each theme is a flat object covering every colour, font, and stroke-weight
// decision made by any draw*() function in plots.js.  Keeping these values
// here means adding a new preset requires only a new entry in PLOT_THEMES;
// renderers never need to change for theming purposes.
//
// Usage in any draw*() function
// ------------------------------
//   import { PLOT_THEMES } from "./plotThemes.js";
//   const T = PLOT_THEMES[options.theme] ?? PLOT_THEMES["default"];
//   // Replace every "var(--xxx)" with T.fieldName.
//
// Theme field reference — Colour slots
// --------------------------------------
//   bg              SVG background fill injected as a <rect> behind all content.
//                   Use "transparent" for the app-default (page CSS provides it).
//   fg              Study labels; primary text; plot titles.
//   fgMuted         Header labels, axis text, axis titles, legend text.
//   fgSubtle        CI lines (non-imputed), per-study annotation text,
//                   imputed-study point styling, tertiary text.
//
//   accent          RE diamond fill+stroke; weight box fill+stroke; regression
//                   lines; key data curves; main scatter fills.
//   accentFE        FE diamond fill+stroke; FE annotation text.
//   accentREAnnot   RE annotation text in the right column (effect + CI).
//   accentGlow      Semi-transparent accent fill for CI bands, Bayesian HDI
//                   shading, profile-likelihood fill areas.
//   accentLight     Lighter accent for secondary lines (cumulative-funnel cursor,
//                   FE line in cumulative forest).
//
//   pi              Prediction interval line, end-caps, and label text.
//
//   bgSurface       Neutral background for axis tick backgrounds, legend panels,
//                   point-stroke overlay when creating contrast.
//   bgSurfaceHover  Study dot fill in scatter plots (funnel, influence, bubble,
//                   GOSH, Baujat, L'Abbé, Q-Q, radial, caterpillar, BLUP).
//
//   border          Header rule; vertical column separators; axis rules;
//                   structural grid lines and reference-line dashes.
//   borderGrid      Quieter background grid lines (Bayesian posteriors, GOSH,
//                   p-curve axis rules, orchard axis lines).
//   groupSepStroke  Group-boundary horizontal rule.
//   groupLabelFill  Group-boundary label text.
//
//   colorError      High-severity indicator: influence both-high points (high
//                   leverage AND high Cook's D); Egger regression line in funnel.
//   colorWarning    Medium-severity / caution: influence partial (one criterion);
//                   p-curve 33%-power curve; Q-Q and radial plot outliers;
//                   cumulative-forest final-step marker.
//   colorInfo       Informational text color (p-uniform footnotes).
//   colorSuccess    Positive indicator line: PEESE curve in funnel plot.
//
// Theme field reference — Typography / stroke slots
// --------------------------------------------------
//   fontFamily      Applied via style("font-family") to every text element.
//                   Use "inherit" for the app default (picks up page CSS).
//   ciStrokeWidth   Stroke width (px) for individual study CI lines.
//   headerRuleWidth Stroke width (px) for the horizontal header rule.
//   nullLineDash    stroke-dasharray string for the vertical null reference line.
//
// Theme field reference — Behavioural flags (BW-specific)
// --------------------------------------------------------
//   useBwShapes       boolean — when true, renderers substitute shape/hatch
//                     differentiation for categorical color encoding.
//                     Concrete substitutions per plot are listed below under
//                     BW_MARKERS and BW_DASHES.
//   preserveSignalColors  boolean — keep RoB 2 / ROBINS-I traffic-light colors
//                          (green/amber/red) even when useBwShapes is true,
//                          because those colors are the published convention.
//   signalColorNote   string — inline note rendered below RoB plots when
//                     preserveSignalColors is true.  Empty string → no note.
// =============================================================================

export const PLOT_THEMES = {

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
    accentGlow:      "var(--accent-glow)",
    accentLight:     "var(--accent-light)",

    pi:              "var(--accent-light)",

    bgSurface:       "var(--bg-surface)",
    bgSurfaceHover:  "var(--bg-surface-hover)",

    border:          "var(--border-hover)",
    borderGrid:      "var(--border)",
    groupSepStroke:  "var(--border-accent)",
    groupLabelFill:  "var(--color-info)",

    colorError:      "var(--color-error)",
    colorWarning:    "var(--color-warning)",
    colorInfo:       "var(--color-info)",
    colorSuccess:    "var(--color-success, #22aa66)",

    fontFamily:      "inherit",
    ciStrokeWidth:   1.5,
    headerRuleWidth: 1,
    nullLineDash:    "4",

    useBwShapes:          false,
    preserveSignalColors: false,
    signalColorNote:      "",
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
    accentGlow:      "rgba(26,26,26,0.08)",  // faint dark tint for CI bands
    accentLight:     "#767676",   // lighter accent = same grey as FE/PI

    pi:              "#767676",   // PI bracket: same grey as FE

    bgSurface:       "#f8f8f8",   // barely-off-white neutral surface
    bgSurfaceHover:  "#eeeeee",   // light grey for scatter dots

    border:          "#cccccc",   // Thin light-grey rules (header, separators, axes)
    borderGrid:      "#e8e8e8",   // quieter background grid lines
    groupSepStroke:  "#333333",
    groupLabelFill:  "#1a1a1a",

    colorError:      "#b22222",   // dark crimson — high-severity (influence, Egger)
    colorWarning:    "#b86a00",   // dark amber — medium-severity (p-curve power, etc.)
    colorInfo:       "#1a5276",   // dark navy — informational text
    colorSuccess:    "#1a7a3a",   // dark green — PEESE curve

    fontFamily:      "'Times New Roman', Times, serif",
    ciStrokeWidth:   1.5,
    headerRuleWidth: 1,
    nullLineDash:    "4",

    useBwShapes:          false,
    preserveSignalColors: false,
    signalColorNote:      "",
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
    accentGlow:      "rgba(26,26,26,0.08)",  // faint dark tint for CI bands
    accentLight:     "#888888",   // lighter accent = same grey as FE

    pi:              "#666666",

    bgSurface:       "#f8f8f8",
    bgSurfaceHover:  "#eeeeee",

    border:          "#d0d0d0",   // Slightly lighter rules than Cochrane
    borderGrid:      "#ebebeb",   // quieter background grid lines
    groupSepStroke:  "#444444",
    groupLabelFill:  "#1a1a1a",

    colorError:      "#b22222",
    colorWarning:    "#b86a00",
    colorInfo:       "#1a5276",
    colorSuccess:    "#1a7a3a",

    fontFamily:      "Arial, Helvetica, sans-serif",
    ciStrokeWidth:   1.5,
    headerRuleWidth: 1,
    nullLineDash:    "4",

    useBwShapes:          false,
    preserveSignalColors: false,
    signalColorNote:      "",
  },

  // ---------------------------------------------------------------------------
  // Black & white — strict monochrome for journals that prohibit colour and
  // grey shading in figures.  All data and chrome elements use pure black or
  // dark grey; scatter plots and categorical encodings use shape/hatch
  // differentiation (T.useBwShapes = true) instead of hue.
  //
  // Exception: RoB traffic-light cells remain colored (T.preserveSignalColors)
  // because green/amber/red is itself the Cochrane RoB 2 / ROBINS-I published
  // convention — dropping those colors would make the chart non-standard.
  // A note is injected below RoB plots to explain this.
  //
  // For semantic lines that would ordinarily use colorError/colorWarning
  // (Egger line, FAT-PET, PEESE in funnel plot), the renderer step will layer
  // in distinct dash patterns so the lines remain distinguishable without hue.
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
    accentGlow:      "rgba(0,0,0,0.07)",    // extremely faint tint for CI bands
    accentLight:     "#333333",   // dark grey for secondary lines

    pi:              "#000000",

    bgSurface:       "#f0f0f0",
    bgSurfaceHover:  "#d8d8d8",   // medium grey for scatter dots

    border:          "#333333",   // Dark grey keeps rules visible without heavy ink
    borderGrid:      "#cccccc",
    groupSepStroke:  "#000000",
    groupLabelFill:  "#000000",

    colorError:      "#000000",   // shape differentiation takes over (useBwShapes)
    colorWarning:    "#555555",   // dark grey; dash pattern distinguishes in funnel
    colorInfo:       "#555555",
    colorSuccess:    "#333333",

    fontFamily:      "Arial, Helvetica, sans-serif",
    ciStrokeWidth:   1,           // Slightly thinner lines for print legibility
    headerRuleWidth: 1,
    nullLineDash:    "4",

    useBwShapes:          true,
    preserveSignalColors: true,
    signalColorNote:      "Note: Risk of bias traffic-light colors (green/amber/red) are preserved in monochrome output to maintain compatibility with the Cochrane RoB 2 and ROBINS-I published conventions (Sterne et al., 2019; Sterne et al., 2016).",
  },

};

// Ordered list of keys for populating the UI dropdown.
// The "default" entry is always first; the rest are alphabetical by label.
export const PLOT_THEME_ORDER = ["default", "cochrane", "jama", "bw"];

// ---------------------------------------------------------------------------
// BW shape / dash cycling helpers (used when T.useBwShapes === true)
// ---------------------------------------------------------------------------
// Marker shape tokens interpreted by each renderer.  Cycling is by index so
// group assignment is deterministic: index = hashGroupLabel(label) % length.
// Using a hash (not iteration order) means adding/removing a group does not
// reshuffle every other group's marker.
export const BW_MARKERS = [
  "circle",    // ○  open circle   — most neutral
  "square",    // □  open square
  "triangle",  // △  open upward triangle
  "diamond",   // ◇  open diamond
  "cross",     // +  plus/cross
];

// Dash-array strings for differentiating semantic lines in BW mode.
// Index 0 = solid (primary/accent line), 1–4 = secondary lines.
export const BW_DASHES = [
  "none",       // solid — accent / RE line
  "6,3",        // long dash — colorWarning equivalent (FAT-PET)
  "2,3",        // short dash — colorError equivalent (Egger)
  "8,3,2,3",   // dash-dot — colorSuccess equivalent (PEESE)
  "4,4",        // medium dash — additional line if needed
];

// Simple djb2-style hash for deterministic marker assignment by group label.
export function hashGroupLabel(label) {
  let h = 5381;
  for (let i = 0; i < label.length; i++) h = ((h << 5) + h) ^ label.charCodeAt(i);
  return h >>> 0;
}
