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
//   format.js    fmt, fmtP_APA, fmtCI_APA
//   plots.js     drawForest, drawCumulativeForest, drawCaterpillarPlot, drawGoshPlot
//   export.js    serializeSVG, collectPagedSVGs
//   constants.js Z_95
//   report.js    CITATIONS, collectCitations

import { fmt, fmtP_APA, fmtCI_APA } from "./format.js";
import { drawForest, drawCumulativeForest, drawCaterpillarPlot, drawGoshPlot } from "./plots.js";
import { serializeSVG, collectPagedSVGs } from "./export.js";
import { Z_95 } from "./constants.js";
import { normalQuantile } from "./utils.js";
import { CITATIONS, collectCitations } from "./report.js";
import { summaryData, pubBiasData, puniformData, selModelData,
         influenceData, subgroupData, studyTableData, regressionData } from "./sections.js";

// serializeSVG and collectPagedSVGs are imported from export.js.

function liveSVGString(id) {
  const el = document.getElementById(id);
  return el ? serializeSVG(el) : "";
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

// Render a string that may contain <em>…</em> tags as a sequence of plain runs
// with italic runs for the tagged portions. Used for table headers and notes.
function richRuns(text, { bold: isBold = false } = {}) {
  if (!text) return "";
  const bTag = isBold ? "<w:b/>" : "";
  const parts = String(text).split(/(<em>[^<]*<\/em>)/);
  return parts.map(part => {
    if (part.startsWith("<em>")) {
      const inner = xmlEsc(part.slice(4, -5));
      return `<w:r><w:rPr>${bTag}<w:i/></w:rPr><w:t xml:space="preserve">${inner}</w:t></w:r>`;
    }
    const escaped = xmlEsc(part);
    if (!escaped) return "";
    return `<w:r><w:rPr>${bTag}</w:rPr><w:t xml:space="preserve">${escaped}</w:t></w:r>`;
  }).join("");
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
    <w:p>${richRuns(h, { bold: true })}</w:p>
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
    ? `<w:p><w:pPr><w:pStyle w:val="APANote"/></w:pPr>${italic("Note.")}${richRuns(" " + note)}</w:p>`
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
  const d = summaryData(args);
  return [
    paraText("Summary", "Heading1"),
    paraText(d.settings),
    ...apaTableDocx(ctx.nextTable(), d.subtitle, d.headers,
      d.rows.map(r => r.map(run)), d.note),
  ];
}

function docPubBias(args, ctx) {
  const d = pubBiasData(args);
  return [
    paraText("Publication Bias", "Heading1"),
    ...apaTableDocx(ctx.nextTable(), "Tests of Publication Bias",
      d.headers, d.rows.map(r => r.map(run)), d.note),
    paraText(d.fsnLine),
  ];
}

function docPUniform(args, ctx) {
  const d = puniformData(args);
  if (!d) return [];
  return [
    paraText("P-uniform (van Assen et al., 2015)", "Heading1"),
    paraText(d.kLine),
    ...apaTableDocx(ctx.nextTable(), "P-uniform Bias-Corrected Estimates",
      d.headers, d.rows.map(r => r.map(run)), d.note),
  ];
}

function docSelectionModel(args, ctx) {
  const d = selModelData(args);
  if (!d) return [];
  const N = d.nCols;
  const normalizedRows = d.rows.map(r => {
    const padded = [...r];
    while (padded.length < N) padded.push("");
    return padded.slice(0, N).map(run);
  });
  return [
    paraText("Selection Model (Vevea-Hedges, 1995)", "Heading1"),
    paraText(d.metaLine),
    ...apaTableDocx(ctx.nextTable(), d.subtitle, d.headers, normalizedRows, d.note),
  ];
}

function docInfluence(args, ctx) {
  const d = influenceData(args);
  if (!d) return [];
  return [
    paraText("Influence Diagnostics", "Heading1"),
    ...apaTableDocx(ctx.nextTable(), "Leave-One-Out Influence Diagnostics",
      d.headers, d.rows.map(r => r.map(run)), d.note),
  ];
}

function docSubgroup(args, ctx) {
  const d = subgroupData(args);
  if (!d) return [];
  return [
    paraText("Subgroup Analysis", "Heading1"),
    ...apaTableDocx(ctx.nextTable(), d.subtitle, d.headers,
      d.rows.map(r => r.map(run)), d.note),
  ];
}

function docStudyTable(args, ctx) {
  const d = studyTableData(args);
  const bodyRows = [
    ...d.rows.map(r => r.map(run)),
    d.pooledRow.map(bold),
  ];
  return [
    paraText("Study-Level Results", "Heading1"),
    ...apaTableDocx(ctx.nextTable(), "Study-Level Effect Sizes and Weights",
      d.headers, bodyRows, d.note),
  ];
}

function docRegression(args, ctx) {
  const d = regressionData(args);
  if (!d) return [];
  const chunks = [
    paraText("Meta-Regression", "Heading1"),
    paraText(d.metaLine),
    ...apaTableDocx(ctx.nextTable(), "Meta-Regression Coefficients",
      d.coef.headers, d.coef.rows.map(r => r.map(run)), d.coef.note),
  ];
  if (d.modTests) {
    chunks.push(
      paraText("Per-moderator omnibus tests", "Heading2"),
      ...apaTableDocx(ctx.nextTable(), "Per-Moderator Omnibus Tests",
        d.modTests.headers, d.modTests.rows.map(r => r.map(run)), d.modTests.note),
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
      const muSDNote = profile.isTransformedScale ? " (log)" : "";
      const fmtBF = bf => !isFinite(bf) ? "NA" : bf >= 1000 || bf < 0.001 ? bf.toExponential(2) : bf.toFixed(3);
      const bayesRows = [
        [`Posterior mean \u03BC`, `${fmt(muDisp)}  ·  ${widthCrLabel} ${fmtCI_APA(muCIDisp[0], muCIDisp[1])}  ·  SD${muSDNote} = ${fmt(bayesResult.muSD)}`],
        [`Posterior mean \u03C4`, `${fmt(bayesResult.tauMean)}  ·  ${widthCrLabel} ${fmtCI_APA(bayesResult.tauCI[0], bayesResult.tauCI[1])}  ·  SD = ${fmt(bayesResult.tauSD)}`],
        ...(isFinite(reDisp) ? [["Frequentist RE (comparison)", fmt(reDisp)]] : []),
        ...(isFinite(bayesResult.BF10) ? [[`Bayes Factor BF\u2081\u2080 (H\u2081: \u03BC\u22600)`, fmtBF(bayesResult.BF10)]] : []),
        ...(bayesResult.BF10 < 1 && isFinite(bayesResult.BF01) ? [[`BF\u2080\u2081 = 1/BF\u2081\u2080 (H\u2080: \u03BC = 0)`, fmtBF(bayesResult.BF01)]] : []),
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

// ---------------------------------------------------------------------------
// Multivariate DOCX builder
// ---------------------------------------------------------------------------

export async function buildMVDocx({ res, rows = [], alpha = 0.05 }) {
  const { beta, se, ci, z, pval, betaNames = [], tau2, rho_between,
          outcomeIds, n, k, P, QM, df_QM, pQM, QE, df_QE, pQE,
          logLik, AIC, BIC, AICc, struct, method, I2, convergence,
          warnings: engineWarnings = [] } = res;
  const hasMods = beta.length > P;
  const ciPct   = Math.round((1 - alpha) * 100);
  const fP      = p => !isFinite(p) ? "—" : p < 0.001 ? "< .001" : "= " + (+p).toFixed(3).replace(/^0\./, ".");

  // Collect MV forest SVG strings from DOM
  const forestSVGStrings = (() => {
    const combined = document.getElementById("mvForestPlotCombined");
    const combinedBlock = document.getElementById("mvForestCombinedBlock");
    if (combinedBlock && combinedBlock.style.display !== "none" && combined) {
      const s = serializeSVG(combined); return s ? [s] : [];
    }
    const result = [];
    for (let o = 0; o < outcomeIds.length; o++) {
      const el = document.getElementById(`mvForestPlot-${o}`);
      if (el) { const s = serializeSVG(el); if (s) result.push(s); }
    }
    return result;
  })();

  // Convert SVGs to PNGs
  const pngResults = await Promise.all(forestSVGStrings.map(s => svgStringToPng(s)));
  let imgCounter = 0;
  const forestImgs = pngResults.map(png => {
    if (!png || !png.blob) return null;
    imgCounter++;
    return { ...png, rId: `rId${imgCounter}`, idx: imgCounter };
  }).filter(Boolean);

  // APA counters
  let _tblN = 0, _figN = 0;
  const nextTable  = () => ++_tblN;
  const nextFigure = () => ++_figN;

  // Pooled estimates table
  const pooledHeaders = ["Outcome", "Estimate", "SE", `${ciPct}% CI`, "z", "p"];
  const pooledRows = outcomeIds.map((id, o) => {
    const [lo, hi] = ci[o];
    return [run(String(id)), run(fmt(beta[o], 4)), run(fmt(se[o], 4)),
            run(`[${fmt(lo, 4)}, ${fmt(hi, 4)}]`), run(fmt(z[o], 3)), run(fP(pval[o]))];
  });

  // Heterogeneity table
  const hetHeaders = struct === "CS"
    ? ["Outcome", "τ²", "I²", "ρ (between)"]
    : ["Outcome", "τ²", "I²"];
  const hetRows = outcomeIds.map((id, o) => {
    const cells = [run(String(id)), run(fmt(tau2[o], 5)),
                   run(isFinite(I2[o]) ? (+I2[o]).toFixed(1) + "%" : "—")];
    if (struct === "CS") cells.push(run(fmt(rho_between ?? 0, 4)));
    return cells;
  });

  // Tests table
  const testHeaders = ["Test", "χ²", "df", "p"];
  const testRows = [
    ...(hasMods && isFinite(QM)
      ? [[run("Omnibus test of moderators (QM)"), run(fmt(QM, 3)), run(String(df_QM)), run(fP(pQM))]]
      : []),
    [run("Residual heterogeneity (QE)"), run(fmt(QE, 3)), run(String(df_QE)), run(fP(pQE))],
  ];

  // Moderator table
  let modChunks = [];
  if (hasMods) {
    const modHeaders = ["Coefficient", "Estimate", "SE", `${ciPct}% CI`, "z", "p"];
    const modRows = beta.slice(P).map((b, i) => {
      const j = P + i;
      const [lo, hi] = ci[j];
      return [run(betaNames[j] ?? `β${j}`), run(fmt(b, 4)), run(fmt(se[j], 4)),
              run(`[${fmt(lo, 4)}, ${fmt(hi, 4)}]`), run(fmt(z[j], 3)), run(fP(pval[j]))];
    });
    modChunks = [...apaTableDocx(nextTable(), "Meta-regression coefficients", modHeaders, modRows), para("")];
  }

  const fitText = `k = ${k} · n = ${n} obs · P = ${P} outcomes`
    + ` | log-lik = ${fmt(logLik, 4)} · AIC = ${fmt(AIC, 2)} · BIC = ${fmt(BIC, 2)}`
    + (isFinite(AICc) ? ` · AICc = ${fmt(AICc, 2)}` : "")
    + ` | ${method}, Ψ = ${struct}`;

  // Individual Studies table
  const zVal = normalQuantile(1 - alpha / 2);
  const studyHeaders = ["Study", "Outcome", "yi", "vi", "SE", `${ciPct}% CI`];
  const studyDocxRows = rows.map(r => {
    const se_r = Math.sqrt(r.vi);
    return [run(String(r.study_id)), run(String(r.outcome_id)),
            run(fmt(r.yi, 4)), run(fmt(r.vi, 4)), run(fmt(se_r, 4)),
            run(`[${fmt(r.yi - zVal * se_r, 4)}, ${fmt(r.yi + zVal * se_r, 4)}]`)];
  });
  const studyChunks = rows.length
    ? [...apaTableDocx(nextTable(), "Individual study effect sizes", studyHeaders, studyDocxRows), para("")]
    : [];

  // RoB images
  const robSVGStrings = (() => {
    const result = [];
    ["robTrafficLight", "robSummary"].forEach(id => {
      const el = document.getElementById(id);
      if (el && el.children.length > 0) { const s = serializeSVG(el); if (s) result.push(s); }
    });
    return result;
  })();
  const robPngResults = await Promise.all(robSVGStrings.map(s => svgStringToPng(s)));
  const robImgs = robPngResults.map(png => {
    if (!png || !png.blob) return null;
    imgCounter++;
    return { ...png, rId: `rId${imgCounter}`, idx: imgCounter };
  }).filter(Boolean);
  const robChunks = robImgs.length
    ? [...robImgs.flatMap(img => apaFigureDocx(nextFigure(), "Risk of bias assessment", [img], "")), para("")]
    : [];

  // References
  const linkMgr = new HyperlinkManager();
  const mvCitationHTMLs = [
    `Berkey, C. S., Hoaglin, D. C., Antczak-Bouckoms, A., Mosteller, F., &amp; Colditz, G. A. (1998). Meta-analysis of multiple outcomes by regression with random effects. <em>Statistics in Medicine</em>, <em>17</em>(22), 2537–2550.`,
    `Cheung, M. W.-L. (2014). Modeling dependent effect sizes with three-level meta-analyses: a structural equation modeling approach. <em>Psychological Methods</em>, <em>19</em>(2), 211–229.`,
    `Cochran, W. G. (1954). The combination of estimates from different experiments. <em>Biometrics</em>, <em>10</em>(1), 101–129.`,
    `Higgins, J. P. T., Thompson, S. G., Deeks, J. J., &amp; Altman, D. G. (2003). Measuring inconsistency in meta-analyses. <em>BMJ</em>, <em>327</em>(7414), 557–560.`,
    `Jackson, D., Riley, R., &amp; White, I. R. (2011). Multivariate meta-analysis: Potential and promise. <em>Statistics in Medicine</em>, <em>30</em>(20), 2481–2498.`,
    `Riley, R. D., Abrams, K. R., Sutton, A. J., Lambert, P. C., &amp; Thompson, J. R. (2007). Bivariate random-effects meta-analysis and the estimation of between-study correlation. <em>BMC Medical Research Methodology</em>, <em>7</em>, 3.`,
    `Viechtbauer, W. (2005). Bias and efficiency of meta-analytic variance estimators in the random-effects model. <em>Journal of Educational and Behavioral Statistics</em>, <em>30</em>(3), 261–293.`,
  ];
  const refChunks = [
    paraText("References", "Heading1"),
    ...mvCitationHTMLs.map(html =>
      `<w:p><w:pPr><w:pStyle w:val="APAReference"/></w:pPr>${citationToRunXML(html, linkMgr)}</w:p>`
    ),
  ];

  const allImgs = [...forestImgs, ...robImgs];

  const bodyChunks = [
    para(bold("Multivariate Meta-Analysis Report"), "Heading1"),
    paraText(`Generated ${new Date().toLocaleDateString()} · k = ${k} studies, P = ${P} outcomes · ${method}, Ψ = ${struct}`, "APANote"),
    ...(convergence === false ? [paraText("Warning: Optimizer did not fully converge — interpret results with caution.")] : []),
    para(""),
    ...apaTableDocx(nextTable(), `Pooled effect estimates per outcome (${method}, Ψ = ${struct})`, pooledHeaders, pooledRows),
    para(""),
    ...apaTableDocx(nextTable(), "Between-study heterogeneity", hetHeaders, hetRows),
    para(""),
    ...apaTableDocx(nextTable(), "Hypothesis tests", testHeaders, testRows),
    para(""),
    ...modChunks,
    paraText(fitText, "APANote"),
    para(""),
    ...forestImgs.flatMap(img => apaFigureDocx(nextFigure(), "Forest plot of multivariate meta-analysis results", [img], "")),
    para(""),
    ...studyChunks,
    ...robChunks,
    ...refChunks,
  ].filter(Boolean);

  const zip = new window.JSZip();
  zip.file("[Content_Types].xml", contentTypesXML(imgCounter));
  zip.file("_rels/.rels",          rootRelsXML());
  zip.file("word/document.xml",    wrapDocumentXML(bodyChunks.join("\n")));
  zip.file("word/styles.xml",      stylesXML());
  zip.file("word/settings.xml",    settingsXML());
  zip.file("word/_rels/document.xml.rels", docRelsXML(imgCounter, linkMgr));
  allImgs.forEach((img, i) => zip.file(`word/media/image${i + 1}.png`, img.blob));

  return zip.generateAsync({ type: "blob" });
}
