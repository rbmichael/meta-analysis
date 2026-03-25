// =============================================================================
// export.js — SVG and PNG plot export
// =============================================================================
// Exports two public functions:
//
//   exportSVG(svgEl, filename)
//     Clones the SVG, makes it self-contained, and downloads it as a .svg file.
//
//   exportPNG(svgEl, filename, scale)
//     Same clone + self-contained step, then rasterises via <canvas> at `scale`×
//     resolution (default 2×) and downloads the result as a .png file.
//
// Self-contained SVG pipeline (shared by both exports)
// -----------------------------------------------------
//   1. Deep-clone the live SVG element (never mutates the DOM).
//   2. Resolve all CSS custom property references (var(--xxx)) in fill/stroke
//      attributes and inline styles, replacing them with computed hex/rgba
//      values.  This is required for standalone SVG files and PNG rasterisation,
//      because both operate outside the page's CSS cascade.
//   3. Add a background rect if the SVG does not already have one (journal
//      presets embed their own white rect via drawForest(); the default theme
//      does not, so a dark fallback rect is injected here).
//
// Dependencies: io.js (downloadBlob, downloadBlobObject)
// =============================================================================

import { downloadBlob, downloadBlobObject } from "./io.js";

// Fallback background colour used when the SVG carries no embedded background
// rect of its own (i.e. the "App default" / dark theme).
const DARK_BACKGROUND = "#121212";

// Regex that matches a single var(--token) reference (one level, no fallback).
const VAR_RE = /var\(\s*(--[\w-]+)\s*\)/g;

// ----------- helpers (exported for report.js) -----------

// resolveThemeVars(svgEl)
// Walks every descendant of svgEl and replaces var(--xxx) references in
// `fill` and `stroke` attributes, and in the fill/stroke/color properties of
// any inline `style` attribute, with the computed value taken from the root
// element's CSS custom properties.
//
// Must be called on the *clone* (not the live SVG) so the live DOM is not
// mutated.  Operates synchronously — getComputedStyle is called once and
// cached for the entire walk.
export function resolveThemeVars(svgEl) {
  const rootStyles = getComputedStyle(document.documentElement);

  function resolveVal(val) {
    return val.replace(VAR_RE, (_, prop) => {
      const resolved = rootStyles.getPropertyValue(prop).trim();
      return resolved || val;   // fall back to the original token if not found
    });
  }

  svgEl.querySelectorAll("*").forEach(el => {
    // Presentation attributes (set by D3 via .attr())
    ["fill", "stroke"].forEach(attr => {
      const val = el.getAttribute(attr);
      if (val && val.includes("var(")) {
        el.setAttribute(attr, resolveVal(val));
      }
    });

    // Inline style properties (set by D3 via .style() or by the SVG renderer)
    if (el.style) {
      ["fill", "stroke", "color"].forEach(prop => {
        const val = el.style.getPropertyValue(prop);
        if (val && val.includes("var(")) {
          el.style.setProperty(prop, resolveVal(val));
        }
      });
    }
  });
}

// hasEmbeddedBackground(svgEl)
// Returns true when the SVG's first child is a <rect> covering the full
// viewport — i.e. a background rect injected by drawForest() for journal
// presets.  Used to avoid stacking a redundant dark rect behind it.
export function hasEmbeddedBackground(svgEl) {
  const first = svgEl.firstElementChild;
  if (!first || first.tagName.toLowerCase() !== "rect") return false;
  const w = first.getAttribute("width");
  const h = first.getAttribute("height");
  // drawForest sets explicit pixel dimensions; treat any explicit non-% value as present
  return w && h && !w.includes("%") && !h.includes("%");
}

// Prepare a cloned, self-contained SVG element ready for serialisation.
function prepareSVGClone(svgEl) {
  const clone = svgEl.cloneNode(true);

  // Required for standalone SVG files and for the canvas data-URL technique.
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");

  // Step 2: resolve CSS vars before anything else so that the background-
  // detection below sees resolved fill values, not var(--bg) strings.
  resolveThemeVars(clone);

  // Step 3: inject a dark background only when the SVG has no embedded rect.
  // Journal presets insert their own rect (white/explicit colour) inside
  // drawForest(); the default theme does not, so we add a dark fallback here.
  if (!hasEmbeddedBackground(clone)) {
    const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    bg.setAttribute("width",  clone.getAttribute("width")  || "100%");
    bg.setAttribute("height", clone.getAttribute("height") || "100%");
    bg.setAttribute("fill",   DARK_BACKGROUND);
    clone.insertBefore(bg, clone.firstChild);
  }

  return clone;
}

// ----------- public API -----------

// Download the given SVG element as a .svg file.
export function exportSVG(svgEl, filename = "plot.svg") {
  if (!svgEl) return;

  const svgStr = new XMLSerializer().serializeToString(prepareSVGClone(svgEl));
  downloadBlob(svgStr, filename, "image/svg+xml;charset=utf-8");
}

// Download the given SVG element as a .png file.
// scale controls output resolution (2 = 2× the SVG's pixel dimensions,
// suitable for retina / print quality).
export function exportPNG(svgEl, filename = "plot.png", scale = 2) {
  if (!svgEl) return;

  const w = +svgEl.getAttribute("width")  || svgEl.getBoundingClientRect().width;
  const h = +svgEl.getAttribute("height") || svgEl.getBoundingClientRect().height;

  const clone  = prepareSVGClone(svgEl);
  const svgStr = new XMLSerializer().serializeToString(clone);

  // Encode as a data URL; UTF-8 encoding handles non-ASCII characters in labels.
  const svgDataURL = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svgStr);

  const canvas  = document.createElement("canvas");
  canvas.width  = w * scale;
  canvas.height = h * scale;

  const ctx = canvas.getContext("2d");
  ctx.scale(scale, scale);

  const img = new Image();
  img.onload = () => {
    ctx.drawImage(img, 0, 0);
    canvas.toBlob(blob => {
      if (!blob) {
        console.error("exportPNG: canvas.toBlob returned null. Falling back to SVG export.");
        exportSVG(svgEl, filename.replace(/\.png$/i, ".svg"));
        return;
      }
      downloadBlobObject(blob, filename);
    }, "image/png");
  };
  img.onerror = () => {
    console.error("exportPNG: failed to load SVG as image. Falling back to SVG export.");
    exportSVG(svgEl, filename.replace(/\.png$/i, ".svg"));
  };
  img.src = svgDataURL;
}
