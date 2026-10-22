import "server-only";

import { google } from "googleapis";
import { persistRotatedRefreshToken } from "./token-store";
import { createGoogleOAuthClient } from "./server";
import { buildGmailRawMessage } from "./mime";

export class GmailRefreshError extends Error {
  constructor(public readonly causeValue: unknown) {
    super("Could not refresh Gmail credentials.");
  }
}

export async function sendSingleGmailMessage(input: {
  ownerId: string;
  accountId: string;
  refreshToken: string;
  from: string;
  recipient: string;
  subject: string;
  text: string;
  attachment?: Uint8Array;
}) {
  const oauth = createGoogleOAuthClient();
  oauth.setCredentials({ refresh_token: input.refreshToken });
  let rotation: Promise<void> | undefined;
  oauth.on("tokens", (tokens) => {
    if (tokens.refresh_token) {
      rotation = persistRotatedRefreshToken(input.ownerId, input.accountId, tokens.refresh_token);
      void rotation.catch(() => undefined);
    }
  });
  try {
    const access = await oauth.getAccessToken();
    if (!access.token) throw new Error("Access token unavailable.");
    if (rotation) await rotation;
  } catch (error) {
    throw new GmailRefreshError(error);
  }

  const raw = await buildGmailRawMessage({ from: input.from, to: input.recipient, subject: input.subject, text: input.text, attachment: input.attachment });
  const response = await google.gmail({ version: "v1", auth: oauth }).users.messages.send({ userId: "me", requestBody: { raw } });
  if (!response.data.id) throw Object.assign(new Error("Gmail response omitted message ID."), { status: 503 });
  return response.data.id;
}
