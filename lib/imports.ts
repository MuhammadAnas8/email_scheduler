import { parse as parseCsv } from "csv-parse/sync";
import { emailRecordSchema } from "./schemas.ts";

export type ImportFormat = "csv" | "json";
export type ImportField = "recipient" | "subject" | "body";
export type ImportIssue = { field: ImportField; message: string };
export type ImportRow = {
  rowNumber: number;
  value: { recipient: string; subject: string; body: string };
  errors: ImportIssue[];
};
export type ImportResult =
  | { ok: true; rows: ImportRow[] }
  | { ok: false; error: string };

const fields = ["recipient", "subject", "body"] as const;

export function parseImport(format: ImportFormat, content: string): ImportResult {
  let rawRows: unknown[];
  try {
    if (format === "json") {
      const parsed: unknown = JSON.parse(content);
      if (!Array.isArray(parsed)) return { ok: false, error: "JSON import must be an array of email records." };
      rawRows = parsed;
    } else {
      rawRows = parseCsv(content, {
        bom: true,
        columns: true,
        skip_empty_lines: true,
        trim: false,
        max_record_size: 1_000_000,
      }) as unknown[];
    }
  } catch {
    return { ok: false, error: `Could not parse ${format.toUpperCase()} import. Check the file syntax and try again.` };
  }

  if (rawRows.length === 0) return { ok: false, error: "The import contains no email records." };
  if (rawRows.length > 200) return { ok: false, error: "A batch can contain at most 200 email records." };

  return {
    ok: true,
    rows: rawRows.map((raw, index) => {
      const result = emailRecordSchema.safeParse(raw);
      if (result.success) return { rowNumber: index + (format === "csv" ? 2 : 1), value: result.data, errors: [] };

      const value = Object.fromEntries(fields.map((field) => [
        field,
        raw && typeof raw === "object" && field in raw ? String((raw as Record<string, unknown>)[field] ?? "") : "",
      ])) as ImportRow["value"];
      const errors = result.error.issues.map((issue) => {
        const field = fields.includes(issue.path[0] as ImportField) ? issue.path[0] as ImportField : "recipient";
        const current = raw && typeof raw === "object" ? (raw as Record<string, unknown>)[field] : undefined;
        const missing = typeof current !== "string" || current.trim() === "";
        const message = missing
          ? field === "recipient" ? "Recipient is required" : field === "subject" ? "Subject is required" : "Message body is required"
          : issue.message;
        return { field, message };
      });
      return { rowNumber: index + (format === "csv" ? 2 : 1), value, errors };
    }),
  };
}
