// =============================================================================
// docx.js — Word (.docx) export
// =============================================================================
// Exports buildDocx(args) → Promise<Blob>.
// args is the same shape as buildReport() in report.js.
// Always uses APA formatting.
//
// Requires window.JSZip (loaded via CDN <script> in index.html).
//
// Dependencies
// ------------
//   plots.js     drawForest, drawCumulativeForest, drawCaterpillarPlot, drawGoshPlot
//   export.js    resolveThemeVars, hasEmbeddedBackground
//   constants.js Z_95
//   report.js    CITATIONS, collectCitations

import { drawForest, drawCumulativeForest, drawCaterpillarPlot, drawGoshPlot } from "./plots.js";
import { resolveThemeVars, hasEmbeddedBackground, currentBgColour } from "./export.js";
import { Z_95 } from "./constants.js";
import { normalQuantile } from "./utils.js";
import { CITATIONS, collectCitations } from "./report.js";

// ---------------------------------------------------------------------------
// SVG serialization (mirrors report.js)
// ---------------------------------------------------------------------------

function serializeSVG(svgEl) {
  if (!svgEl) return "";
  const clone = svgEl.cloneNode(true);
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  const w = clone.getAttribute("width")  || String(svgEl.getBoundingClientRect().width);
  const h = clone.getAttribute("height") || String(svgEl.getBoundingClientRect().height);
  clone.setAttribute("width",  w);
  clone.setAttribute("height", h);
  resolveThemeVars(clone);
  if (!hasEmbeddedBackground(clone)) {
    const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    bg.setAttribute("width",  "100%");
    bg.setAttribute("height", "100%");
    bg.setAttribute("fill", currentBgColour());
    clone.insertBefore(bg, clone.firstChild);
  }
  return new XMLSerializer().serializeToString(clone);
}

function liveSVGString(id) {
  const el = document.getElementById(id);
  return el ? serializeSVG(el) : "";
}

// Collect all pages of a paginated plot into SVG strings (mirrors collectForestSVGs).
function collectPagedSVGs(svgId, drawFn, drawArgs, options) {
  const svgEl = document.getElementById(svgId);
  if (!svgEl) return [];
  const svgs = [];
  let totalPages = 1;
  try {
    ({ totalPages } = drawFn(...drawArgs, { ...options, page: 0 }));
    svgs.push(serializeSVG(svgEl));
  } catch (e) { return []; }
  for (let p = 1; p < totalPages; p++) {
    try { drawFn(...drawArgs, { ...options, page: p }); svgs.push(serializeSVG(svgEl)); }
    catch (e) {}
  }
  try { drawFn(...drawArgs, { ...options, page: options.currentPage ?? 0 }); }
  catch (e) {}
  return svgs;
}

// ---------------------------------------------------------------------------
// SVG → PNG rasterisation (canvas pipeline from export.js)
// ---------------------------------------------------------------------------

function parseSVGDims(svgString) {
  const w = parseFloat(svgString.match(/\swidth="([^"]+)"/)?.[1]  || "800");
  const h = parseFloat(svgString.match(/\sheight="([^"]+)"/)?.[1] || "600");
  return { w: isFinite(w) && w > 0 ? w : 800, h: isFinite(h) && h > 0 ? h : 600 };
}

// Returns Promise<{blob, svgW, svgH}> or null on failure.
//
// scale=2: canvas is rendered at 2× CSS pixel dimensions for retina/high-DPI
// quality. The PNG file therefore contains svgW*2 × svgH*2 pixels.
//
// IMPORTANT — scale does NOT affect the EMU display dimensions in the DOCX.
// inlineImage() always uses svgW and svgH (1× CSS px), which maps correctly to
// physical size via PX_EMU = 9525 (1 CSS px = 1/96 inch = 9525 EMU). The result
// is a 192 dpi PNG rendered at a 96 dpi physical frame — exactly what Word and
// PDF renderers need for retina-quality output. No downsampling occurs.
async function svgStringToPng(svgString, scale = 2) {
  if (!svgString) return null;
  const { w: svgW, h: svgH } = parseSVGDims(svgString);
  const canvas = document.createElement("canvas");
  canvas.width  = Math.round(svgW * scale);
  canvas.height = Math.round(svgH * scale);
  const ctx = canvas.getContext("2d");
  ctx.scale(scale, scale);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, svgW, svgH);
  const dataURL = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svgString);
  const blob = await new Promise(resolve => {
    const img = new Image();
    img.onload  = () => { ctx.drawImage(img, 0, 0); canvas.toBlob(b => resolve(b || null), "image/png"); };
    img.onerror = () => resolve(null);
    img.src = dataURL;
  });
  return blob ? { blob, svgW, svgH } : null;
}

// ---------------------------------------------------------------------------
// Hyperlink manager
// ---------------------------------------------------------------------------

// Deduplicating hyperlink rId registry.
//
// rId namespace in document.xml.rels:
//   rId{n}      — images (1-based, assigned in imgReg build loop)
//   rIdH{n}     — hyperlinks (assigned here; "H" infix prevents collision with images)
//   rIdStyles, rIdSettings — fixed literal suffixes, no overlap with either above
//
// Deduplication: same URL submitted twice → same rIdH{n} returned both times.
// The Map guarantees each URL appears exactly once in the rels file regardless
// of how many times it is referenced in the document body.
class HyperlinkManager {
  constructor() { this._map = new Map(); this._n = 0; }
  getId(url) {
    if (this._map.has(url)) return this._map.get(url);
    const id = `rIdH${++this._n}`;
    this._map.set(url, id);
    return id;
  }
  entries() { return Array.from(this._map.entries()).map(([url, id]) => ({ id, url })); }
}

// ---------------------------------------------------------------------------
// Open XML primitive builders
// ---------------------------------------------------------------------------

function xmlEsc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Plain text run.
function run(text) {
  if (text === null || text === undefined || text === "") return "";
  return `<w:r><w:t xml:space="preserve">${xmlEsc(String(text))}</w:t></w:r>`;
}

// Bold run.
function bold(text) {
  if (!text) return "";
  return `<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${xmlEsc(String(text))}</w:t></w:r>`;
}

// Italic run.
function italic(text) {
  if (!text) return "";
  return `<w:r><w:rPr><w:i/></w:rPr><w:t xml:space="preserve">${xmlEsc(String(text))}</w:t></w:r>`;
}

// External hyperlink. rId must be registered in document.xml.rels.
function hyperlink(rId, text) {
  return `<w:hyperlink r:id="${rId}" w:history="1"><w:r><w:rPr><w:rStyle w:val="Hyperlink"/></w:rPr><w:t xml:space="preserve">${xmlEsc(String(text))}</w:t></w:r></w:hyperlink>`;
}

// Paragraph. content is pre-built run/hyperlink XML; style is optional styleId.
function para(content, style) {
  const pPr = style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : "";
  return `<w:p>${pPr}${content}</w:p>`;
}

// Convenience: paragraph with plain text.
function paraText(text, style) { return para(run(text), style); }

// Inline image paragraph. svgW/svgH are the original SVG CSS pixel dimensions
// (1× scale, not the 2× canvas used during rasterisation). imgIdx is the
// 1-based document image counter (used for docPr id/name).
//
// PX_EMU = 9525: 1 CSS px = 1/96 inch; 1 inch = 914 400 EMU → 914400/96 = 9525.
// MAX_CX = 5 486 400 EMU = 6 inches (standard body width for 1.25" margins on
// US Letter). Images wider than this are scaled down proportionally.
function inlineImage(rId, svgW, svgH, imgIdx) {
  const MAX_CX  = 5486400; // 6 inches in EMU (body width at 1.25" margins)
  const PX_EMU  = 9525;    // 1 CSS px at 96 dpi = 914400/96 = 9525 EMU
  let cxEmu = Math.round(svgW * PX_EMU);
  let cyEmu = Math.round(svgH * PX_EMU);
  if (cxEmu > MAX_CX) { cyEmu = Math.round(cyEmu * MAX_CX / cxEmu); cxEmu = MAX_CX; }
  const NS_A   = "http://schemas.openxmlformats.org/drawingml/2006/main";
  const NS_PIC = "http://schemas.openxmlformats.org/drawingml/2006/picture";
  return `<w:p><w:r><w:drawing>
  <wp:inline distT="0" distB="0" distL="0" distR="0">
    <wp:extent cx="${cxEmu}" cy="${cyEmu}"/>
    <wp:docPr id="${imgIdx}" name="Figure${imgIdx}"/>
    <wp:cNvGraphicFramePr><a:graphicFrameLocks xmlns:a="${NS_A}" noChangeAspect="1"/></wp:cNvGraphicFramePr>
    <a:graphic xmlns:a="${NS_A}">
      <a:graphicData uri="${NS_PIC}">
        <pic:pic xmlns:pic="${NS_PIC}">
          <pic:nvPicPr>
            <pic:cNvPr id="${imgIdx}" name="Figure${imgIdx}"/>
            <pic:cNvPicPr/>
          </pic:nvPicPr>
          <pic:blipFill>
            <a:blip r:embed="${rId}"/>
            <a:stretch><a:fillRect/></a:stretch>
          </pic:blipFill>
          <pic:spPr>
            <a:xfrm><a:off x="0" y="0"/><a:ext cx="${cxEmu}" cy="${cyEmu}"/></a:xfrm>
            <a:prstGeom prst="rect"><a:avLst/></a:prstGeom>
          </pic:spPr>
        </pic:pic>
      </a:graphicData>
    </a:graphic>
  </wp:inline>
</w:drawing></w:r></w:p>`;
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function fmt(v, d = 3) { return isFinite(v) ? (+v).toFixed(d) : "\u2014"; }

function fmtP_APA(p) {
  if (!isFinite(p)) return "\u2014";
  if (p < 0.001) return "< .001";
  return "= " + (+p).toFixed(3).replace(/^0\./, ".");
}

function fmtCI_APA(lo, hi, d = 3) { return `[${fmt(lo, d)}, ${fmt(hi, d)}]`; }

// Convert an HTML citation string (from CITATIONS) to OOXML run+hyperlink XML.
// Handles: <em>…</em>, <a href="…">…</a>, <br>, &amp;, &lt;, &gt;
function citationToRunXML(htmlStr, linkMgr) {
  // Unescape HTML entities (the CITATIONS strings use &amp; etc.)
  const s = htmlStr
    .replace(/&amp;/g,  "&")
    .replace(/&lt;/g,   "<")
    .replace(/&gt;/g,   ">")
    .replace(/&quot;/g, '"');

  const parts = [];
  const re = /<em>(.*?)<\/em>|<a href="([^"]+)">(.*?)<\/a>|<br>/g;
  let lastIdx = 0, m;
  while ((m = re.exec(s)) !== null) {
    const before = s.slice(lastIdx, m.index);
    if (before) parts.push(run(before));
    if (m[0] === "<br>") {
      parts.push(run("  "));          // separator between dual entries (Duval & Tweedie)
    } else if (m[1] !== undefined) {
      parts.push(italic(m[1]));
    } else {
      parts.push(hyperlink(linkMgr.getId(m[2]), m[3]));
    }
    lastIdx = m.index + m[0].length;
  }
  const after = s.slice(lastIdx);
  if (after) parts.push(run(after));
  return parts.join("");
}

// ---------------------------------------------------------------------------
// APA table builder
// ---------------------------------------------------------------------------
// headers : string[]
// rows    : Array<Array<string>>  — each inner string is pre-built OOXML run XML
// Returns an array of XML string chunks (title para, subtitle para, tbl, note para).

function apaTableDocx(tableNum, subtitle, headers, rows, note) {
  const N = headers.length;
  const colW = Math.floor(9360 / N); // twips; 9360 ≈ 6.5" usable width

  const gridCols = headers.map(() => `<w:gridCol w:w="${colW}"/>`).join("");

  const headerRow = `<w:tr>
  <w:trPr><w:tblHeader/></w:trPr>
  ${headers.map(h => `<w:tc>
    <w:tcPr><w:tcBorders>
      <w:bottom w:val="single" w:sz="6" w:space="0" w:color="000000"/>
    </w:tcBorders></w:tcPr>
    <w:p><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${xmlEsc(h)}</w:t></w:r></w:p>
  </w:tc>`).join("")}
</w:tr>`;

  const bodyRowsXML = rows.map(cells => `<w:tr>
  ${cells.map(cellXML => `<w:tc><w:p>${cellXML || ""}</w:p></w:tc>`).join("")}
</w:tr>`).join("\n");

  const tableXML = `<w:tbl>
<w:tblPr>
  <w:tblW w:w="0" w:type="auto"/>
  <w:tblBorders>
    <w:top    w:val="single" w:sz="12" w:space="0" w:color="000000"/>
    <w:bottom w:val="single" w:sz="12" w:space="0" w:color="000000"/>
    <w:insideH w:val="none"  w:sz="0"  w:space="0" w:color="auto"/>
    <w:insideV w:val="none"  w:sz="0"  w:space="0" w:color="auto"/>
    <w:left   w:val="none"  w:sz="0"  w:space="0" w:color="auto"/>
    <w:right  w:val="none"  w:sz="0"  w:space="0" w:color="auto"/>
  </w:tblBorders>
</w:tblPr>
<w:tblGrid>${gridCols}</w:tblGrid>
${headerRow}
${bodyRowsXML}
</w:tbl>`;

  const notePara = note
    ? `<w:p><w:pPr><w:pStyle w:val="APANote"/></w:pPr>${italic("Note.")}${run(" " + note)}</w:p>`
    : "";

  return [
    paraText(`Table ${tableNum}`, "APATableTitle"),
    paraText(subtitle, "APATableSubtitle"),
    tableXML,
    ...(notePara ? [notePara] : []),
  ];
}

// ---------------------------------------------------------------------------
// APA figure builder
// ---------------------------------------------------------------------------
// imgs : Array<{blob, svgW, svgH, rId, idx}> — pre-collected PNG records

function apaFigureDocx(figNum, title, imgs, note) {
  const chunks = [
    paraText(`Figure ${figNum}`, "APAFigureNum"),
    paraText(title, "APAFigureTitle"),
  ];
  for (const img of imgs) {
    if (!img || !img.blob) continue;
    chunks.push(inlineImage(img.rId, img.svgW, img.svgH, img.idx));
  }
  if (note) {
    chunks.push(`<w:p><w:pPr><w:pStyle w:val="APANote"/></w:pPr>${italic("Note.")}${run(" " + note)}</w:p>`);
  }
  return chunks;
}

// ---------------------------------------------------------------------------
// Section body builders
// Each returns an array of OOXML XML string chunks.
// ---------------------------------------------------------------------------

function docSummary(args, ctx) {
  const { m, profile, method, ciMethod, useTF, tf, mAdjusted, studies, widthCiLabel, ciLevel } = args;
  const k = studies.filter(d => !d.filled).length;
  const isMHorPeto = m.isMH || m.isPeto;
  const FE_disp  = profile.transform(m.FE);
  const RE_disp  = isMHorPeto ? null : profile.transform(m.RE);
  const ci       = { lb: profile.transform(m.ciLow),   ub: profile.transform(m.ciHigh) };
  const pred     = { lb: profile.transform(m.predLow), ub: profile.transform(m.predHigh) };
  const RE_adj   = (!isMHorPeto && useTF && mAdjusted) ? profile.transform(mAdjusted.RE) : null;
  const feAlpha  = { "90": 0.10, "95": 0.05, "99": 0.01 }[ciLevel] ?? 0.05;
  const feZ      = normalQuantile(1 - feAlpha / 2);
  const feCi     = { lb: profile.transform(m.FE - feZ * m.seFE), ub: profile.transform(m.FE + feZ * m.seFE) };
  const tauCI1   = fmt(m.tauCI?.[0]);
  const tauCI2   = isFinite(m.tauCI?.[1]) ? fmt(m.tauCI[1]) : "\u221E";
  const H2hi     = isFinite(m.H2CI?.[1])  ? fmt(m.H2CI[1])  : "\u221E";
  const ciLabel  = ciMethod === "KH" ? "Knapp-Hartung"
                 : ciMethod === "t"  ? "t-distribution"
                 : ciMethod === "PL" ? "Profile Likelihood"
                 : "Normal (z)";
  const methodLabel = m.isMH ? "Mantel-Haenszel" : m.isPeto ? "Peto" : method;

  const settings = `Effect type: ${profile.label}  \u00B7  Pooling: ${methodLabel}  \u00B7  CI method: ${ciLabel}  \u00B7  k\u202F=\u202F${k}${tf.length > 0 ? ` + ${tf.length} imputed (trim\u202F&\u202Ffill)` : ""}`;

  const rows = [
    [`${profile.label} \u2014 Fixed Effects (FE)`, fmt(FE_disp)],
    [`FE ${widthCiLabel}`,         fmtCI_APA(feCi.lb, feCi.ub)],
    ...(!isMHorPeto ? [[`${profile.label} \u2014 Random Effects (RE)`, fmt(RE_disp)]] : []),
    ...(!isMHorPeto ? [[`RE ${widthCiLabel}`,       fmtCI_APA(ci.lb, ci.ub)]] : []),
    ...(isMHorPeto  ? [[widthCiLabel,               fmtCI_APA(ci.lb, ci.ub)]] : []),
    ...(RE_adj !== null ? [["RE (trim-and-fill adjusted)", fmt(RE_adj)]] : []),
    ...(!isMHorPeto ? [["95% Prediction interval (PI)", fmtCI_APA(pred.lb, pred.ub)]] : []),
    ...(!isMHorPeto ? [["\u03C4\u00B2", `${fmt(m.tau2)} [${tauCI1}, ${tauCI2}]`]] : []),
    ["I\u00B2",                   `${fmt(m.I2)}% [${fmt(m.I2CI?.[0])}%, ${fmt(m.I2CI?.[1])}%]`],
    ...(!isMHorPeto ? [["H\u00B2-CI", `[${fmt(m.H2CI?.[0])}, ${H2hi}]`]] : []),
    [`Q (df\u202F=\u202F${m.df})`, fmt(m.Q)],
    ...(m.dist ? [[`${m.dist}-statistic`, `${fmt(m.stat)}, p ${fmtP_APA(m.pval)}`]] : []),
    // Cluster-robust SE (shown when cluster IDs are present)
    ...(m.isClustered ? [
      [`Robust CI (C\u202F=\u202F${m.clustersUsed} clusters)`,
       `${fmtCI_APA(profile.transform(m.robustCiLow), profile.transform(m.robustCiHigh))}  \u00B7  SE\u202F=\u202F${fmt(m.robustSE)}  \u00B7  z\u202F=\u202F${fmt(m.robustStat)}, p ${fmtP_APA(m.robustPval)}`],
    ] : []),
  ];

  const note = isMHorPeto
    ? `Fixed-effect pooling (${methodLabel}) — RE estimate, \u03C4\u00B2, and prediction interval not applicable. FE = fixed effects; CI = confidence interval.`
    : `FE = fixed effects; RE = random effects; CI = confidence interval; PI = prediction interval.${m.isClustered ? " Robust CI uses cluster-robust (sandwich) standard errors." : ""}`;

  return [
    paraText("Summary", "Heading1"),
    paraText(settings),
    ...apaTableDocx(ctx.nextTable(),
      `Summary of Meta-Analysis Results (${profile.label})`,
      ["Statistic", "Value"],
      rows.map(([s, v]) => [run(s), run(v)]),
      note),
  ];
}

function docPubBias(args, ctx) {
  const { egger, begg, fatpet, fsn, tes, hc, useTF, tf, profile } = args;
  const petEff = isFinite(fatpet?.intercept) ? fmt(profile.transform(fatpet.intercept)) : "\u2014";

  const tesRow = tes && isFinite(tes.chi2)
    ? [`TES \u2014 \u03C7\u00B2 (O=${tes.O}, E=${fmt(tes.E)})`, fmt(tes.chi2), fmtP_APA(tes.p)]
    : ["TES (excess significance)", "\u2014", "NA"];

  const hcRow = hc && !hc.error
    ? [`Henmi-Copas CI`, `${fmt(profile.transform(hc.beta))} [${fmt(profile.transform(hc.ci[0]))}, ${fmt(profile.transform(hc.ci[1]))}]`, "\u2014"]
    : ["Henmi-Copas CI", "\u2014", "NA (k < 3)"];

  const rows = [
    ["Egger\u2019s test (intercept)",          isFinite(egger?.intercept)   ? fmt(egger.intercept)   : "\u2014", isFinite(egger?.p)         ? fmtP_APA(egger.p)         : "NA (k < 3)"],
    ["Begg\u2019s test (rank correlation \u03C4)", isFinite(begg?.tau)      ? fmt(begg.tau)          : "\u2014", isFinite(begg?.p)          ? fmtP_APA(begg.p)          : "NA (k < 3)"],
    ["FAT \u2014 \u03B2\u2081 (bias)",         isFinite(fatpet?.slope)      ? fmt(fatpet.slope)      : "\u2014", isFinite(fatpet?.slopeP)   ? fmtP_APA(fatpet.slopeP)   : "NA (k < 3)"],
    ["PET \u2014 effect at SE \u2192 0",       petEff,                                                            isFinite(fatpet?.interceptP) ? fmtP_APA(fatpet.interceptP) : "NA (k < 3)"],
    tesRow,
    hcRow,
  ];

  const fsnLine = [
    `Fail-safe N (Rosenthal): ${isFinite(fsn?.rosenthal) ? Math.round(fsn.rosenthal) : "\u2014"}`,
    `Fail-safe N (Orwin): ${isFinite(fsn?.orwin) ? Math.round(fsn.orwin) : "\u2014"}`,
    `Trim\u202F&\u202FFill: ${useTF ? "ON" : "OFF"}${tf?.length > 0 ? ` (${tf.length} filled)` : ""}`,
  ].join("  \u00B7  ");

  return [
    paraText("Publication Bias", "Heading1"),
    ...apaTableDocx(ctx.nextTable(), "Tests of Publication Bias",
      ["Test", "Statistic", "p"],
      rows.map(r => r.map(run)),
      "FAT = funnel asymmetry test; PET = precision-effect test; TES = test of excess significance; Henmi-Copas = bias-robust CI centred on FE estimate (DL \u03C4\u00B2). NA = fewer than 3 studies."),
    paraText(fsnLine),
  ];
}

function docPUniform(args, ctx) {
  const { puniform, m, profile, widthCiLabel } = args;
  if (!puniform || puniform.k < 3 || !isFinite(puniform.estimate)) return [];

  function tr(v) { return profile.transform(v); }

  const noteExtra = [
    puniform.biasDetected      ? "Bias detected (p < .05)." : "",
    puniform.significantEffect ? "Significant effect after correction (p < .05)." : "",
  ].filter(Boolean).join(" ");

  const rows = [
    ["RE (uncorrected)",           fmt(tr(m.RE)),              fmtCI_APA(tr(m.ciLow), tr(m.ciHigh)), fmt(puniform.Z_bias), fmtP_APA(puniform.p_bias)],
    ["P-uniform (bias-corrected)", fmt(tr(puniform.estimate)), fmtCI_APA(tr(puniform.ciLow), tr(puniform.ciHigh)), fmt(puniform.Z_sig), fmtP_APA(puniform.p_sig)],
  ];

  const note = "RE row: bias test (H\u2080: RE = true effect). P-uniform row: significance test (H\u2080: \u03B4\u202F=\u202F0). CI = confidence interval."
    + (noteExtra ? " " + noteExtra : "");

  return [
    paraText("P-uniform (van Assen et al., 2015)", "Heading1"),
    paraText(`${puniform.k} significant result${puniform.k !== 1 ? "s" : ""} (p\u202F<\u202F.05) used  \u00B7  effect scale: ${profile.label}`),
    ...apaTableDocx(ctx.nextTable(), "P-uniform Bias-Corrected Estimates",
      ["Method", "Estimate", widthCiLabel, "Z", "p"],
      rows.map(r => r.map(run)), note),
  ];
}

function docSelectionModel(args, ctx) {
  const { sel, selMode, selLabel, profile, widthCiLabel } = args;
  if (!sel || sel.error) return [];

  const isMLE = selMode === "mle";
  function fmtDisp(v) { return isFinite(v) ? fmt(profile.transform(v)) : "\u2014"; }
  function fmtV(v)    { return isFinite(v) ? fmt(v) : "\u2014"; }

  const cuts = sel.cuts;
  const intervalLabels = cuts.map((c, j) => `(${j === 0 ? "0" : cuts[j - 1]}, ${c}]`);
  const headers = ["Quantity", ...intervalLabels];

  const muAdj = fmtDisp(sel.mu);
  const ciLo  = fmtDisp(sel.mu - 1.96 * sel.se_mu);
  const ciHi  = fmtDisp(sel.mu + 1.96 * sel.se_mu);

  const tableRows = [
    ["Selection weight \u03C9", ...sel.omega.map((w, j) => {
      if (!isMLE || j === 0) return `${fmtV(w)} (fixed)`;
      const se = isFinite(sel.se_omega[j]) ? ` \u00B1 ${fmtV(sel.se_omega[j])}` : "";
      return `${fmtV(w)}${se}`;
    })],
    ["Studies per interval", ...sel.nPerInterval.map(String)],
    [`Adjusted \u03BC\u0302 [${widthCiLabel}]`, `${muAdj} [${ciLo}, ${ciHi}]  \u00B7  unadjusted: ${fmtDisp(sel.RE_unsel)}`],
    ["Adjusted \u03C4\u00B2",          `${fmtV(sel.tau2)}  \u00B7  unadjusted: ${fmtV(sel.tau2_unsel)}`],
    ...(isMLE && isFinite(sel.LRT) ? [["LRT (H\u2080: no selection)", `\u03C7\u00B2(${sel.LRTdf})\u202F=\u202F${fmtV(sel.LRT)}, p ${fmtP_APA(sel.LRTp)}`]] : []),
  ];

  // Pad rows to header count (first row has all columns; others may span)
  const N = headers.length;
  const normalizedRows = tableRows.map(r => {
    const padded = [...r];
    while (padded.length < N) padded.push("");
    return padded.slice(0, N).map(run);
  });

  const modeLabel  = isMLE ? "MLE (estimated weights)" : `Sensitivity \u2014 ${selLabel}`;
  const sidesLabel = sel.sides === 2 ? "two-sided" : "one-sided";

  return [
    paraText("Selection Model (Vevea-Hedges, 1995)", "Heading1"),
    paraText(`Mode: ${modeLabel}  \u00B7  p-values: ${sidesLabel}  \u00B7  k\u202F=\u202F${sel.k}`),
    ...apaTableDocx(ctx.nextTable(), "Selection Model Results", headers, normalizedRows,
      "\u03C9 = selection weight. CI = confidence interval."),
  ];
}

function docInfluence(args, ctx) {
  const { influence, studies } = args;
  if (!influence || !influence.length) return [];

  const k       = studies.filter(d => !d.filled).length;
  const thresh2k = fmt(2 / k);
  const thresh4k = fmt(4 / k);

  const headers = ["Study", "RE (LOO)", "\u0394\u03C4\u00B2", "Std. Residual", "DFBETA", "Hat", "Cook\u2019s D", "Flag"];

  const rows = influence.map(d => [
    d.label,
    isFinite(d.RE_loo)      ? fmt(d.RE_loo)      : "\u2014",
    isFinite(d.deltaTau2)   ? fmt(d.deltaTau2)   : "\u2014",
    isFinite(d.stdResidual) ? fmt(d.stdResidual) : "\u2014",
    isFinite(d.DFBETA)      ? fmt(d.DFBETA)      : "\u2014",
    isFinite(d.hat)         ? d.hat.toFixed(3)   : "\u2014",
    isFinite(d.cookD)       ? d.cookD.toFixed(3) : "\u2014",
    [d.outlier ? "Outlier" : "", d.influential ? "Influential" : "",
     d.highLeverage ? "Hi-Lev" : "", d.highCookD ? "Hi-Cook" : ""].filter(Boolean).join(", "),
  ].map(run));

  return [
    paraText("Influence Diagnostics", "Heading1"),
    ...apaTableDocx(ctx.nextTable(), "Leave-One-Out Influence Diagnostics", headers, rows,
      `LOO = leave-one-out. Threshold: Hat\u202F>\u202F${thresh2k} (= 2/k); Cook\u2019s D\u202F>\u202F${thresh4k} (= 4/k).`),
  ];
}

function docSubgroup(args, ctx) {
  const { subgroup, profile, widthCiLabel } = args;
  if (!subgroup || subgroup.G < 2) return [];

  const headers = ["Group", "k", "Effect size", "SE", widthCiLabel, "\u03C4\u00B2", "I\u00B2 (%)"];

  const rows = Object.entries(subgroup.groups).map(([g, r]) => {
    const single = r.k === 1;
    const y_disp = profile.transform(r.y);
    const ci_lb  = profile.transform(r.ci.lb);
    const ci_ub  = profile.transform(r.ci.ub);
    return [
      g, String(r.k),
      isFinite(y_disp) ? fmt(y_disp) : "\u2014",
      single ? "\u2014" : (isFinite(r.se)   ? fmt(r.se)        : "\u2014"),
      single ? "\u2014" : fmtCI_APA(ci_lb, ci_ub),
      single ? "\u2014" : (isFinite(r.tau2) ? r.tau2.toFixed(3) : "0"),
      single ? "\u2014" : (isFinite(r.I2)   ? r.I2.toFixed(1)   : "0"),
    ].map(run);
  });

  const note = `CI = confidence interval. Q_between\u202F=\u202F${subgroup.Qbetween.toFixed(3)}, df\u202F=\u202F${subgroup.df}, p ${fmtP_APA(subgroup.p)}.`;

  return [
    paraText("Subgroup Analysis", "Heading1"),
    ...apaTableDocx(ctx.nextTable(), `Subgroup Analysis Results (${profile.label})`, headers, rows, note),
  ];
}

function docStudyTable(args, ctx) {
  const { studies, m, profile, widthCiLabel } = args;
  const tau2   = isFinite(m.tau2) ? m.tau2 : 0;
  const real   = studies.filter(d => !d.filled);
  const totalW = real.reduce((s, d) => s + 1 / (d.vi + tau2), 0);

  const transformedScale = ["Ratio", "Hazard", "Rate", "log", "logit", "arcsine", "Freeman", "Fisher"]
    .some(t => profile.label.includes(t));
  const seLabel = transformedScale ? "SE (transformed)" : "SE";

  function fmtV(v)   { return isFinite(v) ? (+v).toFixed(3) : "\u2014"; }
  function fmtPct(v) { return (v !== null && isFinite(v)) ? v.toFixed(1) + "%" : "\u2014"; }

  const pooledEf = profile.transform(m.RE);
  const pooledLo = profile.transform(m.ciLow);
  const pooledHi = profile.transform(m.ciHigh);

  const headers = ["Study", `Effect size (${profile.label})`, seLabel, widthCiLabel, "RE Weight (%)"];

  const rows = studies.map(d => {
    const wi  = 1 / (d.vi + tau2);
    const pct = d.filled ? null : wi / totalW * 100;
    const ef  = profile.transform(d.yi);
    const lo  = profile.transform(d.yi - Z_95 * d.se);
    const hi  = profile.transform(d.yi + Z_95 * d.se);
    const lbl = d.label.length > 40 ? d.label.slice(0, 39) + "\u2026" : d.label;
    return [run(lbl), run(fmtV(ef)), run(fmtV(d.se)), run(fmtCI_APA(lo, hi)), run(fmtPct(pct))];
  });

  // Pooled row — bold cells
  rows.push([bold("Pooled (RE)"), bold(fmtV(pooledEf)), bold(fmtV(m.seRE)), bold(fmtCI_APA(pooledLo, pooledHi)), bold("100%")]);

  const note = `Effect size = ${profile.label}. SE = standard error. CI = confidence interval. RE weights shown.`
    + (studies.some(d => d.filled) ? " Trim-and-fill imputed rows are included." : "");

  return [
    paraText("Study-Level Results", "Heading1"),
    ...apaTableDocx(ctx.nextTable(), "Study-Level Effect Sizes and Weights", headers, rows, note),
  ];
}

function docRegression(args, ctx) {
  const { reg, method, ciMethod, widthCiLabel } = args;
  if (!reg || reg.rankDeficient || !reg.colNames) return [];

  const ciLabel   = ciMethod === "KH" ? "Knapp-Hartung" : "Normal CI";
  const statLabel = reg.dist === "t" ? `t(${reg.QEdf})` : "z";
  const QMlabel   = reg.QMdist === "F" ? `F(${reg.QMdf},\u202F${reg.QEdf})` : `\u03C7\u00B2(${reg.QMdf})`;
  const hasVif    = Array.isArray(reg.vif) && reg.vif.some(v => isFinite(v));

  const coefHeaders = ["Predictor", "\u03B2", "SE", statLabel, "p", widthCiLabel];
  if (hasVif) coefHeaders.push("VIF");

  const coefRows = reg.colNames.map((name, j) => {
    const [lo, hi] = reg.ci[j];
    const cells = [run(name), run(fmt(reg.beta[j])), run(fmt(reg.se[j])),
                   run(fmt(reg.zval[j])), run(fmtP_APA(reg.pval[j])), run(fmtCI_APA(lo, hi))];
    if (hasVif) cells.push(run(j === 0 ? "\u2014" : (isFinite(reg.vif?.[j]) ? fmt(reg.vif[j]) : "\u2014")));
    return cells;
  });

  const R2row = reg.p > 1 && isFinite(reg.R2) ? ` R\u00B2\u202F=\u202F${fmt(reg.R2 * 100)}%.` : "";
  const coefNote = `\u03B2 = unstandardised regression coefficient. SE = standard error. CI = confidence interval. `
    + `QE(${reg.QEdf})\u202F=\u202F${fmt(reg.QE)}, p ${fmtP_APA(reg.QEp)}.`
    + (reg.p > 1 ? ` QM ${QMlabel}\u202F=\u202F${fmt(reg.QM)}, p ${fmtP_APA(reg.QMp)}.` : "")
    + R2row;

  const chunks = [
    paraText("Meta-Regression", "Heading1"),
    paraText(`k\u202F=\u202F${reg.k}  \u00B7  ${method}  \u00B7  ${ciLabel}  \u00B7  \u03C4\u00B2\u202F=\u202F${fmt(reg.tau2)}  \u00B7  I\u00B2\u202F=\u202F${fmt(reg.I2)}%`),
    ...apaTableDocx(ctx.nextTable(), "Meta-Regression Coefficients", coefHeaders, coefRows, coefNote),
  ];

  if (reg.modTests && reg.modTests.length > 1) {
    const modQlabel = reg.QMdist === "F" ? "F" : "\u03C7\u00B2";
    const hasLRT_docx = reg.modTests.some(mt => isFinite(mt.lrt));
    const modHeaders = [
      "Moderator",
      `${modQlabel} (Wald)`,
      ...(hasLRT_docx ? ["LRT \u03C7\u00B2"] : []),
      "df",
      "p (Wald)",
      ...(hasLRT_docx ? ["p (LRT)"] : []),
    ];
    const modRows = reg.modTests.map(mt => [
      run(mt.name),
      run(fmt(mt.QM)),
      ...(hasLRT_docx ? [run(isFinite(mt.lrt) ? fmt(mt.lrt) : "NA")] : []),
      run(String(mt.QMdf)),
      run(fmtP_APA(mt.QMp)),
      ...(hasLRT_docx ? [run(isFinite(mt.lrtP) ? fmtP_APA(mt.lrtP) : "NA")] : []),
    ]);
    chunks.push(
      paraText("Per-moderator omnibus tests", "Heading2"),
      ...apaTableDocx(ctx.nextTable(), "Per-Moderator Omnibus Tests",
        modHeaders, modRows,
        hasLRT_docx ? "LRT = Likelihood Ratio Test; uses ML estimation internally regardless of \u03C4\u00B2 method." : ""),
    );
  }

  return chunks;
}

function docReferences(args, linkMgr) {
  const keys = collectCitations(args);
  if (!keys.length) return [];

  const chunks = [paraText("References", "Heading1")];

  const items = keys
    .map(k => CITATIONS[k])
    .filter(Boolean)
    .filter((ref, i, arr) => arr.indexOf(ref) === i)    // de-duplicate (ML/REML share text)
    .sort((a, b) => {
      const plain = s => s.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&");
      return plain(a).localeCompare(plain(b));
    });

  for (const htmlStr of items) {
    const runXML = citationToRunXML(htmlStr, linkMgr);
    chunks.push(`<w:p><w:pPr><w:pStyle w:val="APAReference"/></w:pPr>${runXML}</w:p>`);
  }

  return chunks;
}

// ---------------------------------------------------------------------------
// Static XML templates
// ---------------------------------------------------------------------------

function contentTypesXML(imageCount) {
  const imgEntries = Array.from({ length: imageCount }, (_, i) =>
    `  <Override PartName="/word/media/image${i + 1}.png" ContentType="image/png"/>`
  ).join("\n");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml"  ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml"   ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>
${imgEntries}
</Types>`;
}

function rootRelsXML() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;
}

function settingsXML() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:compat>
    <w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/>
  </w:compat>
</w:settings>`;
}

function stylesXML() {
  const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="${W}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <w:docDefaults>
    <w:rPrDefault><w:rPr>
      <w:rFonts w:ascii="Times New Roman" w:hAnsi="Times New Roman" w:cs="Times New Roman"/>
      <w:sz w:val="24"/><w:szCs w:val="24"/>
    </w:rPr></w:rPrDefault>
    <w:pPrDefault><w:pPr><w:spacing w:after="0"/></w:pPr></w:pPrDefault>
  </w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/><w:basedOn w:val="Normal"/>
    <w:pPr><w:spacing w:before="240" w:after="60"/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading2">
    <w:name w:val="heading 2"/><w:basedOn w:val="Normal"/>
    <w:pPr><w:spacing w:before="160" w:after="40"/></w:pPr>
    <w:rPr><w:b/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="APATableTitle">
    <w:name w:val="APA Table Title"/><w:basedOn w:val="Normal"/>
    <w:pPr><w:spacing w:before="240" w:after="0"/></w:pPr>
    <w:rPr><w:b/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="APATableSubtitle">
    <w:name w:val="APA Table Subtitle"/><w:basedOn w:val="Normal"/>
    <w:pPr><w:spacing w:before="0" w:after="60"/></w:pPr>
    <w:rPr><w:i/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="APAFigureNum">
    <w:name w:val="APA Figure Num"/><w:basedOn w:val="Normal"/>
    <w:pPr><w:spacing w:before="240" w:after="0"/></w:pPr>
    <w:rPr><w:b/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="APAFigureTitle">
    <w:name w:val="APA Figure Title"/><w:basedOn w:val="Normal"/>
    <w:pPr><w:spacing w:before="0" w:after="60"/></w:pPr>
    <w:rPr><w:i/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="APANote">
    <w:name w:val="APA Note"/><w:basedOn w:val="Normal"/>
    <w:pPr><w:spacing w:before="40" w:after="0"/></w:pPr>
    <w:rPr><w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="APAReference">
    <w:name w:val="APA Reference"/><w:basedOn w:val="Normal"/>
    <w:pPr><w:spacing w:after="120"/><w:ind w:left="720" w:hanging="720"/></w:pPr>
    <w:rPr><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr>
  </w:style>
  <w:style w:type="character" w:styleId="Hyperlink">
    <w:name w:val="Hyperlink"/>
    <w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr>
  </w:style>
</w:styles>`;
}

function wrapDocumentXML(bodyContent) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document
  xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"
  xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
  xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"
  xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
  xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
<w:body>
${bodyContent}
<w:sectPr>
  <w:pgSz w:w="12240" w:h="15840"/>
  <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>
</w:sectPr>
</w:body>
</w:document>`;
}

function docRelsXML(imageCount, linkMgr) {
  const imgRels = Array.from({ length: imageCount }, (_, i) =>
    `  <Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image${i + 1}.png"/>`
  ).join("\n");

  const linkRels = linkMgr.entries().map(({ id, url }) =>
    `  <Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${xmlEsc(url)}" TargetMode="External"/>`
  ).join("\n");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rIdStyles"   Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles"   Target="styles.xml"/>
  <Relationship Id="rIdSettings" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>
${imgRels}
${linkRels}
</Relationships>`;
}

// ---------------------------------------------------------------------------
// buildDocx() — main entry point
// ---------------------------------------------------------------------------

export async function buildDocx(args) {
  const {
    studies, m, profile, reg, tf, influence, subgroup,
    method, ciMethod, ciLevel, useTF, mAdjusted,
    forestOptions, cumForestOptions, caterpillarOptions,
    pcurve, puniform, sel, selMode, selLabel,
    gosh, goshXAxis,
    bayesResult, bayesReMean,
    sensitivityRows,
  } = args;

  const widthCiLabel = (ciLevel ?? "95") + "% CI";
  const widthCrLabel = (ciLevel ?? "95") + "% CrI";

  // Augment args so section helpers can access CI width labels
  const docArgs = { ...args, widthCiLabel, widthCrLabel };

  // ── 1. Collect all SVG strings synchronously ────────────────────────────

  // Named sets: key → string[]
  const svgArrays = new Map();

  svgArrays.set("forest",
    forestOptions
      ? collectPagedSVGs("forestPlot", drawForest, [studies, m], forestOptions)
      : [liveSVGString("forestPlot")].filter(Boolean));

  svgArrays.set("funnel",       [liveSVGString("funnelPlot")].filter(Boolean));
  svgArrays.set("influence",    [liveSVGString("influencePlot")].filter(Boolean));
  svgArrays.set("baujat",       [liveSVGString("baujatPlot")].filter(Boolean));
  svgArrays.set("qqplot",       [liveSVGString("qqPlot")].filter(Boolean));

  svgArrays.set("cumForest",
    cumForestOptions
      ? collectPagedSVGs("cumulativePlot", drawCumulativeForest,
          [cumForestOptions.results, cumForestOptions.profile ?? profile], cumForestOptions)
      : [liveSVGString("cumulativePlot")].filter(Boolean));

  svgArrays.set("cumFunnel",    [liveSVGString("cumulativeFunnelPlot")].filter(Boolean));
  svgArrays.set("pcurve",       [liveSVGString("pCurvePlot")].filter(Boolean));
  svgArrays.set("puniformPlot", [liveSVGString("pUniformPlot")].filter(Boolean));
  svgArrays.set("orchard",      [liveSVGString("orchardPlot")].filter(Boolean));

  svgArrays.set("caterpillar",
    caterpillarOptions
      ? collectPagedSVGs("caterpillarPlot", drawCaterpillarPlot,
          [caterpillarOptions.studies ?? studies, caterpillarOptions.m ?? m, caterpillarOptions.profile ?? profile],
          caterpillarOptions)
      : [liveSVGString("caterpillarPlot")].filter(Boolean));

  svgArrays.set("robTL",        [liveSVGString("robTrafficLight")].filter(Boolean));
  svgArrays.set("robSummary",   [liveSVGString("robSummary")].filter(Boolean));

  // Bubble plots (one key per moderator)
  const bubbleMods = [];  // [{key, mod}] in order
  const bubbleContainer = document.getElementById("bubblePlots");
  const rawBubbles = bubbleContainer
    ? Array.from(bubbleContainer.querySelectorAll("[data-moderator]"))
        .map(el => ({ svg: serializeSVG(el.querySelector("svg")), mod: el.dataset.moderator }))
        .filter(b => b.svg)
    : [];
  const fallbackBubbles = (!rawBubbles.length && bubbleContainer)
    ? Array.from(bubbleContainer.querySelectorAll("svg"))
        .map(el => ({ svg: serializeSVG(el), mod: "" })).filter(b => b.svg)
    : [];
  const allBubbles = rawBubbles.length ? rawBubbles : fallbackBubbles;
  for (let i = 0; i < allBubbles.length; i++) {
    const key = `bubble_${i}`;
    svgArrays.set(key, [allBubbles[i].svg]);
    bubbleMods.push({ key, mod: allBubbles[i].mod });
  }

  // GOSH (needs re-render to SVG circles)
  if (gosh && !gosh.error) {
    drawGoshPlot(gosh, profile, { xAxis: goshXAxis ?? "I2", forReport: true });
    svgArrays.set("gosh", [liveSVGString("goshPlot")].filter(Boolean));
    drawGoshPlot(gosh, profile, { xAxis: goshXAxis ?? "I2" });
  }

  // Profile likelihood + Bayesian
  svgArrays.set("profileLik", [liveSVGString("profileLikTau2Plot")].filter(Boolean));
  if (bayesResult && !bayesResult.error) {
    svgArrays.set("bayesMu",  [liveSVGString("bayesMuPlot")].filter(Boolean));
    svgArrays.set("bayesTau", [liveSVGString("bayesTauPlot")].filter(Boolean));
  }

  // ── 2. Convert all SVGs to PNGs in parallel ─────────────────────────────

  // Flatten to a single array for one Promise.all call.
  const flatItems = [];
  for (const [key, svgs] of svgArrays) {
    for (let i = 0; i < svgs.length; i++) {
      flatItems.push({ key, pageIdx: i });
    }
  }
  // Build a matching flat array of SVG strings for conversion.
  const flatSVGs = [];
  for (const [key, svgs] of svgArrays) {
    for (const svg of svgs) flatSVGs.push(svg);
  }

  const pngResults = await Promise.all(flatSVGs.map(svg => svgStringToPng(svg)));

  // Build image registry: key → [{blob, svgW, svgH, rId, idx}]
  const imgReg = new Map();
  let imgCounter = 0;
  for (let i = 0; i < flatItems.length; i++) {
    const { key } = flatItems[i];
    if (!imgReg.has(key)) imgReg.set(key, []);
    const png = pngResults[i];
    if (png && png.blob) {
      imgCounter++;
      imgReg.get(key).push({ ...png, rId: `rId${imgCounter}`, idx: imgCounter });
    }
  }

  const getImgs = key => (imgReg.get(key) || []).filter(img => img.blob);

  // ── 3. Build document body ──────────────────────────────────────────────

  const linkMgr = new HyperlinkManager();
  let _tblN = 0, _figN = 0;
  const ctx = { nextTable: () => ++_tblN, nextFigure: () => ++_figN, imgReg, linkMgr };

  // Helper: emit a named section heading + APA figure from a single image key.
  function figSection(heading, key, apaTitle, apaNote) {
    const imgs = getImgs(key);
    if (!imgs.length) return [];
    return [paraText(heading, "Heading1"), ...apaFigureDocx(ctx.nextFigure(), apaTitle, imgs, apaNote)];
  }

  const k = studies.filter(d => !d.filled).length;
  const ciLabel = ciMethod === "KH" ? "Knapp-Hartung"
                : ciMethod === "t"  ? "t-distribution"
                : ciMethod === "PL" ? "Profile Likelihood"
                : "Normal (z)";
  const date = new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });

  const bodyChunks = [
    // Title + metadata
    paraText("Meta-Analysis Report", "Heading1"),
    paraText(`Generated ${date}  \u00B7  k\u202F=\u202F${k}${tf.length > 0 ? ` + ${tf.length} imputed` : ""}  \u00B7  ${profile.label}  \u00B7  ${method}  \u00B7  ${ciLabel}`),

    // Statistical sections
    ...docSummary(docArgs, ctx),
    ...docPubBias(docArgs, ctx),
    ...docPUniform(docArgs, ctx),
    ...docSelectionModel(docArgs, ctx),

    // Bayesian
    ...(() => {
      if (!bayesResult || bayesResult.error) return [];
      const muImgs  = getImgs("bayesMu");
      const tauImgs = getImgs("bayesTau");
      if (!muImgs.length && !tauImgs.length) return [];
      const muDisp   = profile.transform(bayesResult.muMean);
      const muCIDisp = bayesResult.muCI.map(v => profile.transform(v));
      const reDisp   = isFinite(bayesReMean) ? profile.transform(bayesReMean) : NaN;
      const priorLine = `Prior: \u03BC\u202F~\u202FN(${bayesResult.mu0},\u202F${bayesResult.sigma_mu}\u00B2)  \u00B7  \u03C4\u202F~\u202FHalfNormal(${bayesResult.sigma_tau})  \u00B7  k\u202F=\u202F${bayesResult.k} studies`;
      const bayesRows = [
        [`Posterior mean \u03BC`, `${fmt(muDisp)}  ·  ${widthCrLabel} ${fmtCI_APA(muCIDisp[0], muCIDisp[1])}`],
        [`Posterior mean \u03C4`, `${fmt(bayesResult.tauMean)}  ·  ${widthCrLabel} ${fmtCI_APA(bayesResult.tauCI[0], bayesResult.tauCI[1])}`],
        ...(isFinite(reDisp) ? [["Frequentist RE (comparison)", fmt(reDisp)]] : []),
      ];
      const chunks = [
        paraText("Bayesian Meta-Analysis", "Heading1"),
        paraText(priorLine),
        ...apaTableDocx(ctx.nextTable(),
          `Bayesian Meta-Analysis Results (${profile.label})`,
          ["Statistic", "Value"],
          bayesRows.map(r => r.map(run)),
          `CrI = credible interval. Posterior mean \u03BC on ${profile.label} scale. Frequentist RE shown for comparison only.`),
      ];
      if (muImgs.length)  chunks.push(...apaFigureDocx(ctx.nextFigure(), `Posterior distribution of pooled effect \u03BC (${profile.label})`, muImgs, priorLine));
      if (tauImgs.length) chunks.push(...apaFigureDocx(ctx.nextFigure(), "Posterior distribution of between-study standard deviation \u03C4", tauImgs, `Prior: \u03C4\u202F~\u202FHalfNormal(${bayesResult.sigma_tau}).`));
      if (sensitivityRows && sensitivityRows.length) {
        const sensRows = sensitivityRows.map(row => {
          const muDisp2   = profile.transform(row.muMean);
          const muCIDisp2 = row.muCI.map(v => profile.transform(v));
          const bf = row.BF10;
          const bfStr = !isFinite(bf) ? "NA"
            : bf >= 1000 ? bf.toExponential(2)
            : bf < 0.001 ? bf.toExponential(2)
            : bf.toFixed(3);
          const ciStr = `[${isFinite(muCIDisp2[0]) ? fmt(muCIDisp2[0]) : "NA"}, ${isFinite(muCIDisp2[1]) ? fmt(muCIDisp2[1]) : "NA"}]`;
          return [run(String(row.sigma_mu)), run(String(row.sigma_tau)), run(isFinite(muDisp2) ? fmt(muDisp2) : "NA"), run(ciStr), run(bfStr)];
        });
        chunks.push(...apaTableDocx(ctx.nextTable(),
          "Prior Sensitivity Analysis",
          ["\u03C3_\u03BC", "\u03C3_\u03C4", "Post. \u03BC", `${widthCrLabel}`, "BF\u2081\u2080"],
          sensRows,
          "Grid: \u03C3_\u03BC \u2208 {0.5, 1, 2}, \u03C3_\u03C4 \u2208 {0.25, 0.5, 1}. Diffuse priors approach the frequentist RE estimate."));
      }
      return chunks;
    })(),

    // Profile likelihood
    ...(() => {
      const imgs = getImgs("profileLik");
      if (!imgs.length) return [];
      return [
        paraText("Profile Likelihood for \u03C4\u00B2", "Heading1"),
        ...apaFigureDocx(ctx.nextFigure(), "Profile likelihood curve for \u03C4\u00B2", imgs,
          `Shaded region = ${widthCiLabel} from likelihood-ratio inversion (LRT).`),
      ];
    })(),

    // Influence, subgroup, study table, regression
    ...docInfluence(docArgs, ctx),
    ...docSubgroup(docArgs, ctx),
    ...docStudyTable(docArgs, ctx),
    ...docRegression(docArgs, ctx),

    // Plot figures
    ...figSection("Forest Plot", "forest",
      `Forest plot of ${profile.label}, k\u202F=\u202F${k} studies`,
      `RE = random effects. Error bars = ${widthCiLabel} (${ciLabel}). \u03C4\u00B2 estimated by ${method}. Diamond = pooled estimate and ${widthCiLabel}.`),

    ...figSection("Funnel Plot", "funnel",
      `Funnel plot of ${profile.label} against standard error`,
      "Each point = one study. Asymmetry may indicate publication bias or between-study heterogeneity."),

    ...figSection("Influence Plot", "influence",
      `Influence diagnostics for k\u202F=\u202F${k} studies`,
      `Left panel: standardised residuals. Right panel: leave-one-out (LOO) random-effects estimates with ${widthCiLabel}.`),

    ...figSection("Baujat Plot", "baujat",
      "Baujat plot of contribution to Q statistic against overall influence on the pooled estimate", ""),

    ...figSection("Normal Q-Q Plot", "qqplot",
      "Normal Q-Q plot of internally standardised residuals from the random-effects model",
      "Points near the reference line support the normality assumption. Orange points have |z| > 2."),

    ...figSection("Cumulative Forest Plot", "cumForest",
      `Cumulative forest plot of ${profile.label}`,
      `Studies added in dataset order. Effect and ${widthCiLabel} shown at each cumulative step.`),

    ...figSection("Cumulative Funnel Plot", "cumFunnel", "Cumulative funnel plot", ""),

    ...figSection("P-curve", "pcurve",
      "P-curve of statistically significant results (p\u202F<\u202F.05)",
      "Simonsohn et al. (2014). Only studies with p\u202F<\u202F.05 included."),

    ...figSection("P-uniform", "puniformPlot", "P-uniform plot (van Assen et al., 2015)", ""),

    ...figSection("Orchard Plot", "orchard",
      `Orchard plot of ${profile.label}`,
      `Points scaled by random-effects weight. Thick bar = ${widthCiLabel}; thin bar = ${(ciLevel ?? "95")}% prediction interval.`),

    ...figSection("Caterpillar Plot", "caterpillar",
      `Caterpillar plot of study-level ${profile.label}, sorted by effect size`,
      `Error bars = ${widthCiLabel}.`),

    ...figSection("Risk-of-bias Traffic Light", "robTL", "Risk-of-bias traffic-light plot", ""),
    ...figSection("Risk-of-bias Summary",        "robSummary", "Risk-of-bias summary plot",  ""),

    // Bubble plots (one figure per moderator)
    ...bubbleMods.flatMap(({ key, mod }) => {
      const imgs = getImgs(key);
      if (!imgs.length) return [];
      const title = mod
        ? `Bubble plot of ${mod} against ${profile.label}`
        : `Bubble plot of meta-regression moderator against ${profile.label}`;
      return [
        paraText(mod ? `Bubble Plot \u2014 ${mod}` : "Bubble Plot", "Heading1"),
        ...apaFigureDocx(ctx.nextFigure(), title, imgs,
          "Line = meta-regression fit. Point area proportional to random-effects weight."),
      ];
    }),

    ...figSection("GOSH Plot", "gosh",
      `Graphical Display of Study Heterogeneity (GOSH) plot, k\u202F=\u202F${k} studies`,
      `Each point = one non-empty subset. x-axis: ${goshXAxis === "Q" ? "Q (Cochran\u2019s Q)" : goshXAxis === "n" ? "n (subset size)" : "I\u00B2 (%)"}.`),

    // References
    ...docReferences(args, linkMgr),
  ].filter(chunk => chunk != null && chunk !== "");

  // ── 4. Assemble ZIP ─────────────────────────────────────────────────────

  const zip = new window.JSZip();
  zip.file("[Content_Types].xml", contentTypesXML(imgCounter));
  zip.file("_rels/.rels",          rootRelsXML());
  zip.file("word/document.xml",    wrapDocumentXML(bodyChunks.join("\n")));
  zip.file("word/styles.xml",      stylesXML());
  zip.file("word/settings.xml",    settingsXML());
  zip.file("word/_rels/document.xml.rels", docRelsXML(imgCounter, linkMgr));

  // Add PNG files — must be in rId order (rId1 = image1.png, etc.)
  let fileIdx = 0;
  for (const imgs of imgReg.values()) {
    for (const img of imgs) {
      if (img.blob) {
        fileIdx++;
        zip.file(`word/media/image${fileIdx}.png`, img.blob);
      }
    }
  }

  return zip.generateAsync({ type: "blob" });
}
