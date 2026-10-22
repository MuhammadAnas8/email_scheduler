import "server-only";

import { getGoogleServerEnv } from "@/lib/env";
import { decryptRefreshToken as decrypt, encryptRefreshToken as encrypt, type EncryptedToken } from "./token-crypto-core";

function keyBytes() {
  const { TOKEN_ENCRYPTION_KEY } = getGoogleServerEnv();
  return Buffer.from(TOKEN_ENCRYPTION_KEY, "hex");
}

export function encryptRefreshToken(plaintext: string, ownerId: string, accountId: string): EncryptedToken {
  return encrypt(plaintext, ownerId, accountId, keyBytes());
}

export function decryptRefreshToken(encrypted: EncryptedToken, ownerId: string, accountId: string): string {
  return decrypt(encrypted, ownerId, accountId, keyBytes());
}
