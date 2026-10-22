export const MAX_CV_BYTES = 10 * 1024 * 1024;

export type PdfValidation = { ok: true } | { ok: false; error: string };

export function validatePdfAttachment(bytes: Uint8Array): PdfValidation {
  if (bytes.byteLength === 0) return { ok: false, error: "The PDF file is empty." };
  if (bytes.byteLength > MAX_CV_BYTES) return { ok: false, error: "The PDF must be 10 MiB or smaller." };
  const header = new TextDecoder().decode(bytes.subarray(0, 8));
  const trailer = new TextDecoder().decode(bytes.subarray(Math.max(0, bytes.byteLength - 1024)));
  if (!/^%PDF-[0-9]\.[0-9]/.test(header) || !trailer.includes("%%EOF")) {
    return { ok: false, error: "The uploaded file is not a valid PDF." };
  }
  return { ok: true };
}
