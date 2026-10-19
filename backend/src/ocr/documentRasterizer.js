const JPEG_START = Buffer.from([0xff, 0xd8, 0xff]);
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_START_OF_FRAME = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

function processingError(code) {
  return Object.assign(new Error(code), { code });
}

function positiveDimensions(width, height) {
  return Number.isSafeInteger(width) && width > 0 && Number.isSafeInteger(height) && height > 0;
}

function jpegDimensions(bytes) {
  if (!bytes.subarray(0, JPEG_START.length).equals(JPEG_START)) throw processingError("INVALID_IMAGE");
  let offset = 2;
  while (offset < bytes.length) {
    if (bytes[offset] !== 0xff) throw processingError("INVALID_IMAGE");
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset];
    offset += 1;
    if (marker === undefined || marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
    if (offset + 2 > bytes.length) throw processingError("INVALID_IMAGE");
    const segmentLength = bytes.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > bytes.length) throw processingError("INVALID_IMAGE");
    if (JPEG_START_OF_FRAME.has(marker)) {
      if (segmentLength < 7) throw processingError("INVALID_IMAGE");
      const height = bytes.readUInt16BE(offset + 3);
      const width = bytes.readUInt16BE(offset + 5);
      if (!positiveDimensions(width, height)) throw processingError("INVALID_IMAGE");
      return { width, height };
    }
    offset += segmentLength;
  }
  throw processingError("INVALID_IMAGE");
}

function imageDimensions(bytes, contentType) {
  if (contentType === "image/png") {
    if (bytes.length < 24 || !bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
      throw processingError("INVALID_IMAGE");
    }
    const width = bytes.readUInt32BE(16);
    const height = bytes.readUInt32BE(20);
    if (!positiveDimensions(width, height)) throw processingError("INVALID_IMAGE");
    return { width, height };
  }
  if (contentType === "image/jpeg") return jpegDimensions(bytes);
  throw processingError("UNSUPPORTED_DOCUMENT_TYPE");
}

function validateLimits({ maxPages, maxPixels, dpi }) {
  if (!Number.isSafeInteger(maxPages) || maxPages < 1 || !Number.isSafeInteger(maxPixels) || maxPixels < 1
      || !Number.isSafeInteger(dpi) || dpi < 72 || dpi > 300) {
    throw processingError("INVALID_OCR_CONFIGURATION");
  }
}

export function createDocumentRasterizer(dependencies = {}) {
  let resolvedPdfjs;
  let resolvedCanvas;
  async function getCanvasModule() {
    resolvedCanvas ??= import("@napi-rs/canvas");
    return resolvedCanvas;
  }
  async function alignCanvasGlobals() {
    // pdfjs polyfills Path2D, DOMMatrix, and ImageData from whichever canvas
    // package it can require itself (its own nested @napi-rs/canvas), while
    // pages render onto canvases from this module's copy. When the two copies
    // differ, the context rejects the other copy's path and image objects, so
    // rendering fails on any PDF that uses clipping paths. Pin the globals to
    // the rendering copy before pdfjs is loaded.
    if (dependencies.createCanvas) return;
    const canvasModule = await getCanvasModule();
    for (const name of ["Path2D", "DOMMatrix", "ImageData"]) {
      if (canvasModule[name] && globalThis[name] !== canvasModule[name]) {
        globalThis[name] = canvasModule[name];
      }
    }
  }
  async function getPdfDocument(bytes) {
    if (dependencies.getPdfDocument) return dependencies.getPdfDocument(bytes);
    await alignCanvasGlobals();
    const moduleUrl = import.meta.resolve("pdfjs-dist/legacy/build/pdf.mjs");
    resolvedPdfjs ??= import(moduleUrl);
    const pdfjs = await resolvedPdfjs;
    return pdfjs.getDocument({
      data: Uint8Array.from(bytes),
      isEvalSupported: false,
      useSystemFonts: true,
      stopAtErrors: true,
    }).promise;
  }
  async function getCanvasFactory() {
    if (dependencies.createCanvas) return dependencies.createCanvas;
    return (await getCanvasModule()).createCanvas;
  }

  return Object.freeze({
    async *renderEvidencePages({ bytes, contentType, maxPages = 10, maxPixels = 25_000_000, dpi = 150 }) {
      if (!Buffer.isBuffer(bytes) || bytes.length === 0) throw processingError("INVALID_DOCUMENT");
      validateLimits({ maxPages, maxPixels, dpi });
      if (contentType === "image/jpeg" || contentType === "image/png") {
        let dimensions;
        try {
          dimensions = await (dependencies.inspectImage ?? imageDimensions)(bytes, contentType);
        } catch {
          throw processingError("INVALID_IMAGE");
        }
        const { width, height } = dimensions ?? {};
        if (!positiveDimensions(width, height)) throw processingError("INVALID_IMAGE");
        if (width * height > maxPixels) throw processingError("IMAGE_PIXEL_LIMIT_EXCEEDED");
        yield { pageNumber: 1, bytes, width, height };
        return;
      }

      if (contentType !== "application/pdf") throw processingError("UNSUPPORTED_DOCUMENT_TYPE");
      let document;
      try {
        document = await getPdfDocument(bytes);
      } catch (error) {
        if (error?.name === "PasswordException") throw processingError("ENCRYPTED_PDF");
        throw processingError("INVALID_PDF");
      }
      try {
        if (!Number.isSafeInteger(document?.numPages) || document.numPages < 1) throw processingError("INVALID_PDF");
        if (document.numPages > maxPages) throw processingError("PDF_PAGE_LIMIT_EXCEEDED");
        const scale = dpi / 72;
        for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
          const page = await document.getPage(pageNumber);
          try {
            const viewport = page.getViewport({ scale });
            const width = Math.ceil(viewport.width);
            const height = Math.ceil(viewport.height);
            if (!positiveDimensions(width, height)) throw processingError("INVALID_PDF_PAGE");
            if (width * height > maxPixels) throw processingError("IMAGE_PIXEL_LIMIT_EXCEEDED");
            const canvas = (await getCanvasFactory())(width, height);
            await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
            yield { pageNumber, bytes: canvas.toBuffer("image/png"), width, height };
          } finally {
            page.cleanup?.();
          }
        }
      } finally {
        await document.destroy?.();
      }
    },
  });
}
