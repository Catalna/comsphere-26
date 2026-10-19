import { hashRawEvidence } from "@dana-terang/proof";

const MAX_EVIDENCE_BYTES = 10 * 1024 * 1024;
const EVIDENCE_TYPES = new Set(["RECEIPT", "PHOTO", "REPORT", "INVOICE", "CONTRACT", "OTHER"]);
const FILE_TYPES = new Map([
  ["application/pdf", { extension: [".pdf"], signature: (buffer) => buffer.subarray(0, 5).toString("ascii") === "%PDF-" }],
  ["image/jpeg", { extension: [".jpg", ".jpeg"], signature: (buffer) => buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff }],
  ["image/png", { extension: [".png"], signature: (buffer) => buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) }],
]);

function invalid(code) {
  return Object.assign(new Error(code), { code });
}

function safeFileName(originalname) {
  if (typeof originalname !== "string") throw invalid("INVALID_FILE_NAME");
  const baseName = originalname.replace(/\\/g, "/").split("/").pop()?.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (!baseName || baseName === "." || baseName === ".." || baseName.length > 240) throw invalid("INVALID_FILE_NAME");
  return baseName;
}

export function validateEvidenceUpload({ buffer, mimetype, originalname, evidenceType, maxBytes = MAX_EVIDENCE_BYTES }) {
  if (!Buffer.isBuffer(buffer) && !(buffer instanceof Uint8Array)) throw invalid("INVALID_FILE");
  const bytes = Buffer.from(buffer);
  if (bytes.length === 0) throw invalid("EMPTY_FILE");
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || bytes.length > maxBytes) throw invalid("FILE_TOO_LARGE");
  if (typeof evidenceType !== "string" || !EVIDENCE_TYPES.has(evidenceType)) throw invalid("INVALID_EVIDENCE_TYPE");

  const normalizedMimeType = typeof mimetype === "string" ? mimetype.split(";")[0].trim().toLowerCase() : "";
  const fileType = FILE_TYPES.get(normalizedMimeType);
  if (!fileType) throw invalid("UNSUPPORTED_FILE_TYPE");
  if (!fileType.signature(bytes)) throw invalid("FILE_SIGNATURE_MISMATCH");

  const fileName = safeFileName(originalname);
  const extension = fileName.slice(fileName.lastIndexOf(".")).toLowerCase();
  if (!fileType.extension.includes(extension)) throw invalid("FILE_SIGNATURE_MISMATCH");

  return {
    fileName,
    contentType: normalizedMimeType,
    evidenceType,
    fileSize: bytes.length,
    rawHash: hashRawEvidence(bytes),
    bytes,
  };
}
