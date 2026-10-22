import nodemailer from "nodemailer";
import { z } from "zod";
import { Readable } from "node:stream";

const inputSchema = z.object({
  from: z.string().trim().max(320).pipe(z.email()),
  to: z.string().trim().max(320).pipe(z.email()),
  subject: z.string().trim().min(1).max(998).refine((value) => !/[\r\n\0]/.test(value)),
  text: z.string().min(1).max(10_000).refine((value) => value.trim().length > 0),
  attachment: z.instanceof(Uint8Array).optional(),
}).strict();

export async function buildGmailRawMessage(input: {
  from: string; to: string; subject: string; text: string; attachment?: Uint8Array;
}): Promise<string> {
  const data = inputSchema.parse(input);
  const transport = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: "windows" });
  const message = await transport.sendMail({
    from: data.from,
    to: data.to,
    subject: data.subject,
    text: data.text,
    attachments: data.attachment ? [{ filename: "cv.pdf", content: Buffer.from(data.attachment), contentType: "application/pdf" }] : [],
  });
  let raw: Buffer;
  if (Buffer.isBuffer(message.message)) raw = message.message;
  else {
    const chunks: Buffer[] = [];
    await new Promise<void>((resolve, reject) => {
      (message.message as unknown as Readable)
        .on("data", (chunk: Buffer | Uint8Array | string) => chunks.push(Buffer.from(chunk)))
        .once("end", resolve)
        .once("error", reject);
    });
    raw = Buffer.concat(chunks);
  }
  return raw.toString("base64url");
}
