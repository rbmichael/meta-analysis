// ================= PLOT EXPORT UTILITIES =================
// exportSVG  — downloads the plot as a .svg file
// exportPNG  — downloads the plot as a .png file (2× resolution by default)
//
// Both functions clone the SVG so the live DOM element is never mutated.
// A dark background rect is injected into the clone so exported files
// look identical to the on-screen rendering.

const BACKGROUND = "#121212";

// ----------- internal helpers -----------

// Prepare a cloned, self-contained SVG element ready for serialisation.
function prepareSVGClone(svgEl) {
  const clone = svgEl.cloneNode(true);

  // Ensure the SVG namespace is declared (required for standalone SVG files
  // and for the data-URL trick used in PNG export).
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");

  // Prepend a background rect so the exported file has the dark background
  // rather than transparent / white depending on the viewer.
  const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  bg.setAttribute("width",  "100%");
  bg.setAttribute("height", "100%");
  bg.setAttribute("fill",   BACKGROUND);
  clone.insertBefore(bg, clone.firstChild);

  return clone;
}

// Trigger a file download from a Blob object URL.
// The anchor must be briefly added to the document; detached-element clicks
// are ignored by Firefox and older Safari.
function downloadBlobURL(url, filename) {
  const a = document.createElement("a");
  a.href     = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoke on next tick so the download has time to start.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ----------- public API -----------

// Download the given SVG element as a .svg file.
export function exportSVG(svgEl, filename = "plot.svg") {
  if (!svgEl) return;

  const clone    = prepareSVGClone(svgEl);
  const svgStr   = new XMLSerializer().serializeToString(clone);
  const blob     = new Blob([svgStr], { type: "image/svg+xml;charset=utf-8" });
  const url      = URL.createObjectURL(blob);

  downloadBlobURL(url, filename);
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
      const url = URL.createObjectURL(blob);
      downloadBlobURL(url, filename);
    }, "image/png");
  };
  img.onerror = () => {
    console.error("exportPNG: failed to load SVG as image. Falling back to SVG export.");
    exportSVG(svgEl, filename.replace(/\.png$/i, ".svg"));
  };
  img.src = svgDataURL;
}
