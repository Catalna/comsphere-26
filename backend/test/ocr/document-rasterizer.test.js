import assert from "node:assert/strict";
import test from "node:test";

import { createDocumentRasterizer } from "../../src/ocr/documentRasterizer.js";

async function collectPages(rasterizer, options) {
  const pages = [];
  for await (const page of rasterizer.renderEvidencePages(options)) pages.push(page);
  return pages;
}

function fakePdfDocument(pageCount, { width = 100, height = 200 } = {}) {
  const rendered = [];
  return {
    rendered,
    document: {
      numPages: pageCount,
      async getPage(pageNumber) {
        return {
          getViewport({ scale }) { return { width: width * scale, height: height * scale }; },
          render({ canvasContext, viewport }) {
            rendered.push({ pageNumber, canvasContext, viewport });
            return { promise: Promise.resolve() };
          },
          cleanup() {},
        };
      },
      async destroy() {},
    },
  };
}

function pngHeader(width, height) {
  const bytes = Buffer.alloc(24);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(bytes);
  bytes.writeUInt32BE(13, 8);
  bytes.write("IHDR", 12, "ascii");
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

function jpegHeader(width, height) {
  const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x07, 0x08, 0x00, 0x00, 0x00, 0x00]);
  bytes.writeUInt16BE(height, 7);
  bytes.writeUInt16BE(width, 9);
  return bytes;
}

function minimalPdf(pageCount = 1) {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${Array.from({ length: pageCount }, (_, index) => `${index + 3} 0 R`).join(" ")}] /Count ${pageCount} >>`,
    ...Array.from({ length: pageCount }, (_, index) => `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 72 72] /Resources << >> /Contents ${pageCount + 3} 0 R >>`),
    "<< /Length 0 >>\nstream\n\nendstream",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf);
}

function clippedRectanglePdf() {
  const content = ["0 0 120 120 re W n", "0.93 0.26 0.11 rg", "10 10 100 100 re f"].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 120 120] /Resources << >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf);
}

test("JPEG and PNG are emitted as one page only after decoded dimensions pass the limit", async () => {
  const rasterizer = createDocumentRasterizer();

  for (const [contentType, bytes] of [["image/jpeg", jpegHeader(100, 200)], ["image/png", pngHeader(100, 200)]]) {
    const pages = await collectPages(rasterizer, { bytes, contentType });
    assert.equal(pages.length, 1);
    assert.deepEqual(pages[0], { pageNumber: 1, bytes, width: 100, height: 200 });
  }
});

test("a PDF renders one page at a time at the configured DPI", async () => {
  const pdf = fakePdfDocument(2);
  const rasterizer = createDocumentRasterizer({
    getPdfDocument() { return pdf.document; },
    createCanvas(width, height) {
      return { width, height, getContext: () => ({ canvas: { width, height } }), toBuffer: () => Buffer.from(`${width}x${height}`) };
    },
  });

  const pages = await collectPages(rasterizer, { bytes: Buffer.from("pdf"), contentType: "application/pdf", dpi: 72 });
  assert.equal(pages.length, 2);
  assert.equal(pages[0].pageNumber, 1);
  assert.equal(pages[0].width, 100);
  assert.equal(pages[1].pageNumber, 2);
  assert.deepEqual(pdf.rendered.map(({ pageNumber }) => pageNumber), [1, 2]);
});

test("the installed PDF.js and canvas adapters render a synthetic PDF locally", async () => {
  const pages = await collectPages(createDocumentRasterizer(), {
    bytes: minimalPdf(),
    contentType: "application/pdf",
    dpi: 72,
  });
  assert.equal(pages.length, 1);
  assert.equal(pages[0].width, 72);
  assert.equal(pages[0].height, 72);
  assert.deepEqual(pages[0].bytes.subarray(0, 8), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
});

test("PDFs that clip content through the rendering adapters stay renderable", async () => {
  // Clipping (`W n`) makes pdf.js build Path2D objects and hand them back to the
  // canvas context; this failed whenever pdf.js and the rasterizer ended up with
  // different copies of @napi-rs/canvas (different Path2D class identity).
  const pages = await collectPages(createDocumentRasterizer(), {
    bytes: clippedRectanglePdf(),
    contentType: "application/pdf",
    dpi: 72,
  });
  assert.equal(pages.length, 1);
  assert.equal(pages[0].width, 120);
  assert.equal(pages[0].height, 120);
  assert.deepEqual(pages[0].bytes.subarray(0, 8), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
});

test("malformed and password-protected PDFs fail with safe codes", async () => {
  for (const [error, code] of [
    [new Error("parser detail"), "INVALID_PDF"],
    [Object.assign(new Error("password detail"), { name: "PasswordException" }), "ENCRYPTED_PDF"],
  ]) {
    const rasterizer = createDocumentRasterizer({ getPdfDocument() { throw error; } });
    await assert.rejects(
      collectPages(rasterizer, { bytes: Buffer.from("pdf"), contentType: "application/pdf" }),
      { code },
    );
  }
});

test("PDFs over 10 pages and images over 25 megapixels are rejected before rasterization", async () => {
  const tooManyPages = fakePdfDocument(11);
  const pdfRasterizer = createDocumentRasterizer({
    getPdfDocument() { return tooManyPages.document; },
    createCanvas() { assert.fail("must reject before allocating a canvas"); },
  });
  await assert.rejects(
    collectPages(pdfRasterizer, { bytes: Buffer.from("pdf"), contentType: "application/pdf" }),
    { code: "PDF_PAGE_LIMIT_EXCEEDED" },
  );
  assert.deepEqual(tooManyPages.rendered, []);

  const imageRasterizer = createDocumentRasterizer({
    async inspectImage() { return { width: 5001, height: 5000 }; },
  });
  await assert.rejects(
    collectPages(imageRasterizer, { bytes: Buffer.from("image"), contentType: "image/jpeg" }),
    { code: "IMAGE_PIXEL_LIMIT_EXCEEDED" },
  );
  await assert.rejects(
    collectPages(createDocumentRasterizer(), { bytes: pngHeader(5001, 5000), contentType: "image/png" }),
    { code: "IMAGE_PIXEL_LIMIT_EXCEEDED" },
  );
});

test("PDF pages whose rendered dimensions exceed the pixel limit are rejected before canvas allocation", async () => {
  const pdf = fakePdfDocument(1, { width: 5001, height: 5000 });
  const rasterizer = createDocumentRasterizer({
    getPdfDocument() { return pdf.document; },
    createCanvas() { assert.fail("must reject before allocating a canvas"); },
  });

  await assert.rejects(
    collectPages(rasterizer, { bytes: Buffer.from("pdf"), contentType: "application/pdf", dpi: 72 }),
    { code: "IMAGE_PIXEL_LIMIT_EXCEEDED" },
  );
  assert.deepEqual(pdf.rendered, []);
});
