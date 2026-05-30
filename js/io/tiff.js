// =============================================================================
// tiff.js — Minimal uncompressed RGB TIFF encoder
// =============================================================================
// Exports one public function:
//
//   encodeTIFF(width, height, rgbaData, dpi) → Blob
//     Encodes raw RGBA pixel data (from ctx.getImageData()) as a TIFF Blob.
//     Alpha is dropped; the file is written as 3-channel RGB so it is accepted
//     by journal submission portals that reject alpha-channel rasters.
//     `dpi` is written into the XResolution / YResolution RATIONAL tags so that
//     Photoshop, Preview, and PDF workflows see the correct physical resolution.
//
// No dependencies.  No external libraries.
//
// TIFF file layout produced
// -------------------------
//   Offset   0 :  Header          (8 bytes)
//                  – byte order mark 'II' (little-endian)
//                  – magic 42
//                  – IFD offset = 8
//   Offset   8 :  IFD             (2 + 13×12 + 4 = 162 bytes)
//                  – entry count (13)
//                  – 13 directory entries, sorted by tag number (TIFF requirement)
//                  – next-IFD pointer = 0
//   Offset 170 :  BitsPerSample   (6 bytes — three SHORT values [8, 8, 8])
//   Offset 176 :  XResolution     (8 bytes — RATIONAL dpi/1)
//   Offset 184 :  YResolution     (8 bytes — RATIONAL dpi/1)
//   Offset 192 :  Pixel data      (width × height × 3 bytes, row-major RGB)
//
// Tags written (ascending order, as required by the TIFF 6.0 specification)
// --------------------------------------------------------------------------
//   256  ImageWidth               LONG   1    pixel width
//   257  ImageLength              LONG   1    pixel height
//   258  BitsPerSample            SHORT  3    [8, 8, 8] → offset 170
//   259  Compression              SHORT  1    1 = none
//   262  PhotometricInterpretation SHORT 1    2 = RGB
//   273  StripOffsets             LONG   1    192 (pixel data start)
//   277  SamplesPerPixel          SHORT  1    3
//   278  RowsPerStrip             LONG   1    height (single strip)
//   279  StripByteCounts          LONG   1    width × height × 3
//   282  XResolution              RATIONAL 1  dpi/1 → offset 176
//   283  YResolution              RATIONAL 1  dpi/1 → offset 184
//   284  PlanarConfiguration      SHORT  1    1 = chunky (RGBRGB…)
//   296  ResolutionUnit           SHORT  1    2 = inch
// =============================================================================

// encodeTIFF(width, height, rgbaData, dpi) → Blob
//
// width, height  — canvas pixel dimensions
// rgbaData       — Uint8ClampedArray from ctx.getImageData() (4 bytes per pixel)
// dpi            — dots per inch written into TIFF resolution tags (default 288,
//                  matching the 3× default scale at 96 dpi base resolution)
export function encodeTIFF(width, height, rgbaData, dpi = 288) {
  const NUM_ENTRIES     = 13;
  const IFD_OFFSET      = 8;
  const IFD_SIZE        = 2 + NUM_ENTRIES * 12 + 4;   // 162
  const BPS_OFFSET      = IFD_OFFSET + IFD_SIZE;       // 170 — BitsPerSample [8,8,8]
  const XRES_OFFSET     = BPS_OFFSET  + 6;             // 176 — XResolution RATIONAL
  const YRES_OFFSET     = XRES_OFFSET + 8;             // 184 — YResolution RATIONAL
  const DATA_OFFSET     = YRES_OFFSET + 8;             // 192 — pixel data

  const pixelBytes  = width * height * 3;
  const buf         = new ArrayBuffer(DATA_OFFSET + pixelBytes);
  const view        = new DataView(buf);
  const bytes       = new Uint8Array(buf);

  let p = 0;   // sequential write cursor (header + IFD + extra data only)

  function u8(v)  { view.setUint8(p++, v); }
  function u16(v) { view.setUint16(p, v, /*littleEndian=*/true); p += 2; }
  function u32(v) { view.setUint32(p, v, /*littleEndian=*/true); p += 4; }

  // IFD entry — 12 bytes.
  // SHORT values that fit in 4 bytes are stored inline (value in the first 2
  // bytes of the value/offset field, padded with 0x0000).
  // All other values are stored at the given offset.
  function entry(tag, type, count, valueOrOffset) {
    u16(tag);
    u16(type);
    u32(count);
    if (type === 3 /* SHORT */ && count === 1) {
      u16(valueOrOffset);
      u16(0);            // padding
    } else {
      u32(valueOrOffset);
    }
  }

  // ---- Header (8 bytes) ----
  u8(0x49); u8(0x49);    // 'II' — little-endian byte order
  u16(42);               // TIFF magic number
  u32(IFD_OFFSET);       // offset to first IFD

  // ---- IFD (162 bytes) ----
  u16(NUM_ENTRIES);

  entry(256, 4, 1, width);          // ImageWidth               LONG
  entry(257, 4, 1, height);         // ImageLength              LONG
  entry(258, 3, 3, BPS_OFFSET);     // BitsPerSample            SHORT[3] → extra
  entry(259, 3, 1, 1);              // Compression              SHORT  1=none
  entry(262, 3, 1, 2);              // PhotometricInterpretation SHORT  2=RGB
  entry(273, 4, 1, DATA_OFFSET);    // StripOffsets             LONG
  entry(277, 3, 1, 3);              // SamplesPerPixel          SHORT  3
  entry(278, 4, 1, height);         // RowsPerStrip             LONG   (single strip)
  entry(279, 4, 1, pixelBytes);     // StripByteCounts          LONG
  entry(282, 5, 1, XRES_OFFSET);    // XResolution              RATIONAL → extra
  entry(283, 5, 1, YRES_OFFSET);    // YResolution              RATIONAL → extra
  entry(284, 3, 1, 1);              // PlanarConfiguration      SHORT  1=chunky
  entry(296, 3, 1, 2);              // ResolutionUnit           SHORT  2=inch

  u32(0);                // next-IFD offset = 0 (no further IFDs)

  // ---- Extra data ----

  // BitsPerSample: three SHORT values [8, 8, 8] at offset 170
  u16(8); u16(8); u16(8);

  // XResolution RATIONAL at offset 176: dpi / 1
  u32(dpi); u32(1);

  // YResolution RATIONAL at offset 184: dpi / 1
  u32(dpi); u32(1);

  // ---- Pixel data: RGBA → RGB (drop alpha) ----
  let src = 0;
  let dst = DATA_OFFSET;
  const n = width * height;
  for (let i = 0; i < n; i++) {
    bytes[dst++] = rgbaData[src];       // R
    bytes[dst++] = rgbaData[src + 1];   // G
    bytes[dst++] = rgbaData[src + 2];   // B
    src += 4;                           // skip A
  }

  return new Blob([buf], { type: "image/tiff" });
}
