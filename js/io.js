// ================= FILE I/O PRIMITIVES =================

// Trigger a file download from a pre-existing Blob object.
// Creates a temporary object URL, clicks a hidden anchor, then revokes the URL.
export function downloadBlobObject(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a   = document.createElement("a");
  a.href    = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Download arbitrary data as a file.
// Wraps the data in a Blob and delegates to downloadBlobObject.
export function downloadBlob(data, filename, mimeType) {
  downloadBlobObject(new Blob([data], { type: mimeType }), filename);
}

// Read a File object as a UTF-8 text string.
// Returns a Promise that resolves with the file's text content, or rejects
// if the FileReader fires an error event.
export function readTextFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = e => resolve(e.target.result);
    reader.onerror = ()  => reject(new Error("Could not read the selected file."));
    reader.readAsText(file);
  });
}

// ================= CSV SERIALIZATION =================

// Escape a single field per RFC 4180: wrap in double-quotes if the value
// contains a comma, double-quote, or newline; escape internal quotes by doubling.
export function csvField(value) {
  const s = String(value ?? "");
  if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

// Join an array of values into a single comma-separated CSV row string.
export function csvRow(fields) {
  return fields.map(csvField).join(",");
}

// Serialise a dataset to a complete CSV string.
// Prepends a UTF-8 BOM so Excel opens the file with correct encoding.
// Rows are separated by CRLF per RFC 4180.
export function serializeCSV(headers, rows) {
  const lines = [csvRow(headers), ...rows.map(csvRow)];
  return "\uFEFF" + lines.join("\r\n");
}
