// =============================================================================
// plot-test-env.mjs — jsdom + D3 environment for headless plot smoke tests
// =============================================================================
// Call setup() once before importing plots.js or calling any plot function.
// Injects a minimal DOM (jsdom) and the D3 v7 module as globals so that
// plots.js — which relies on browser globals — runs in Node without changes.
//
// Stubs:
//   SVGElement.prototype.getBBox            → { x:0, y:0, width:100, height:20 }
//   SVGElement.prototype.getComputedTextLength → 100
//   HTMLCanvasElement (via createElement)   → see canvasStub (prevents GOSH
//                                             canvas crash; use forReport:true)
// =============================================================================

import { JSDOM } from "jsdom";
import * as d3   from "d3";

let _document = null;
let _window   = null;

export function setup() {
  const dom = new JSDOM("<!DOCTYPE html><html><body></body></html>", {
    pretendToBeVisual: true,   // enables rAF stub in jsdom
  });

  _window   = dom.window;
  _document = dom.window.document;

  // ── Global injection ──────────────────────────────────────────────────────
  // plots.js reads `d3`, `document`, and `window` as bare globals;
  // set them on globalThis so the module-scope lookups resolve.
  globalThis.window   = _window;
  globalThis.document = _document;
  globalThis.d3       = d3;

  // ── SVGElement stubs ──────────────────────────────────────────────────────
  // jsdom does not implement getBBox or getComputedTextLength (layout).
  // Plots use them for text label sizing; a fixed box is accurate enough
  // for smoke tests — it prevents the "not a function" TypeError.
  const SVGEl = _window.SVGElement;
  if (SVGEl) {
    SVGEl.prototype.getBBox = () => ({ x: 0, y: 0, width: 100, height: 20 });
    SVGEl.prototype.getComputedTextLength = () => 100;
  }

  // ── Canvas stub ───────────────────────────────────────────────────────────
  // GOSH's canvas path is guarded by forReport:true in smoke tests, but stub
  // createElement("canvas") anyway so any accidental path doesn't crash.
  const origCreate = _document.createElement.bind(_document);
  _document.createElement = function(tag) {
    if (tag === "canvas") {
      const el = origCreate("div");   // dummy node
      el.width  = 1;
      el.height = 1;
      el.getContext = () => ({
        createImageData: (w, h) => ({
          data: new Uint8ClampedArray(w * h * 4),
        }),
        putImageData: () => {},
        toDataURL:    () => "data:image/png;base64,",
      });
      el.toDataURL = () => "data:image/png;base64,";
      return el;
    }
    return origCreate(tag);
  };
}

// ── SVG factory helpers ───────────────────────────────────────────────────────

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * Append an <svg> with the given id to document.body and return it.
 * Matches the selector format ("#id") used by initSvg() in plots.js.
 */
export function makeSvg(id, width = 600, height = 450) {
  const svg = _document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("id", id);
  svg.setAttribute("width",  String(width));
  svg.setAttribute("height", String(height));
  _document.body.appendChild(svg);
  return svg;
}

/**
 * Append a <div> container with the given id to document.body and return it.
 * Used by drawBubble / drawPartialResidualBubble, which append their own <svg>.
 */
export function makeContainer(id) {
  const div = _document.createElement("div");
  div.setAttribute("id", id);
  _document.body.appendChild(div);
  return div;
}
