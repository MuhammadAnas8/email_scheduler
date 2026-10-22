import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export type EncryptedToken = {
  ciphertext: Uint8Array;
  nonce: Uint8Array;
  tag: Uint8Array;
  keyVersion: number;
};

function validateKey(key: Uint8Array) {
  if (key.byteLength !== 32) throw new Error("Token encryption key must be 32 bytes.");
}

function aad(ownerId: string, accountId: string) {
  if (!ownerId || !accountId) throw new Error("Token encryption context is invalid.");
  return Buffer.from(`google-refresh:v1:${ownerId}:${accountId}`, "utf8");
}

export function encryptRefreshToken(plaintext: string, ownerId: string, accountId: string, key: Uint8Array): EncryptedToken {
  validateKey(key);
  if (!plaintext) throw new Error("Refresh token is empty.");
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(aad(ownerId, accountId));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return { ciphertext, nonce, tag: cipher.getAuthTag(), keyVersion: 1 };
}

export function decryptRefreshToken(encrypted: EncryptedToken, ownerId: string, accountId: string, key: Uint8Array): string {
  validateKey(key);
  if (encrypted.keyVersion !== 1 || encrypted.nonce.byteLength !== 12 || encrypted.tag.byteLength !== 16 || encrypted.ciphertext.byteLength === 0) {
    throw new Error("Stored refresh token is invalid or uses an unsupported key version.");
  }
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, encrypted.nonce);
    decipher.setAAD(aad(ownerId, accountId));
    decipher.setAuthTag(encrypted.tag);
    return Buffer.concat([decipher.update(encrypted.ciphertext), decipher.final()]).toString("utf8");
  } catch {
    throw new Error("Stored refresh token could not be authenticated.");
  }
}
