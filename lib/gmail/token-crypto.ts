import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function encryptionKey(): Buffer {
  const encoded = process.env.GMAIL_TOKEN_ENCRYPTION_KEY?.trim();
  if (!encoded) throw new Error("Set GMAIL_TOKEN_ENCRYPTION_KEY before connecting Gmail.");
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32) throw new Error("GMAIL_TOKEN_ENCRYPTION_KEY must be a base64-encoded 32-byte key.");
  return key;
}

export function encryptGmailToken(token: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return `v1.${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${encrypted.toString("base64url")}`;
}

export function decryptGmailToken(value: string): string {
  const [version, ivText, tagText, ciphertextText] = value.split(".");
  if (version !== "v1" || !ivText || !tagText || !ciphertextText) throw new Error("The stored Gmail token has an unsupported format.");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivText, "base64url"));
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertextText, "base64url")), decipher.final()]).toString("utf8");
}
