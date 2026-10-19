import { query } from "@/lib/db";
import { decryptGmailToken } from "@/lib/gmail/token-crypto";

type GmailConnectionRow = { refreshTokenCiphertext: string; accountEmail: string | null };

export class GmailOperationError extends Error {
  constructor(message: string, readonly stage: "token_refresh" | "gmail_api", readonly statusCode: number) {
    super(message);
    this.name = "GmailOperationError";
  }
}

async function getConnection(userId: string): Promise<GmailConnectionRow | null> {
  const result = await query<GmailConnectionRow>('SELECT "refreshTokenCiphertext","accountEmail" FROM "GmailConnection" WHERE "userId"=$1', [userId]);
  return result.rows[0] ?? null;
}

export async function gmailConnectionStatus(userId: string) {
  const connection = await getConnection(userId);
  return {
    connected: Boolean(connection),
    accountEmail: connection?.accountEmail ?? null,
    configured: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.GMAIL_REDIRECT_URI && process.env.GMAIL_TOKEN_ENCRYPTION_KEY),
  };
}

async function accessToken(userId: string): Promise<string> {
  const connection = await getConnection(userId);
  if (!connection) throw new GmailOperationError("No Gmail authorization is stored. Connect Gmail again before saving drafts.", "token_refresh", 409);
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new GmailOperationError("Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env.local, then restart the app.", "token_refresh", 503);
  let refreshToken: string;
  try {
    refreshToken = decryptGmailToken(connection.refreshTokenCiphertext);
  } catch {
    throw new GmailOperationError("The stored Gmail authorization cannot be decrypted. The token-encryption key may have changed; disconnect and reconnect Gmail.", "token_refresh", 503);
  }
  let response: Response;
  try {
    response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" }),
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
    });
  } catch {
    throw new GmailOperationError("Could not reach Google's token service. Check the server's internet connection and try again.", "token_refresh", 502);
  }
  const payload = await response.json().catch(() => ({})) as { access_token?: unknown; error?: unknown; error_description?: unknown };
  if (!response.ok || typeof payload.access_token !== "string") {
    if (payload.error === "invalid_grant") {
      throw new GmailOperationError("Google rejected the saved Gmail authorization (invalid_grant). Disconnect Gmail, reconnect, and grant access again.", "token_refresh", 401);
    }
    const detail = typeof payload.error_description === "string" ? payload.error_description.replace(/[\r\n]/g, " ").slice(0, 180) : "Google rejected the refresh token.";
    throw new GmailOperationError(`Gmail token refresh failed (HTTP ${response.status}): ${detail}`, "token_refresh", response.status >= 500 ? 502 : 401);
  }
  return payload.access_token;
}

function htmlEscape(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function bodyAsHtml(body: string) {
  const linkPattern = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
  let content = "";
  let cursor = 0;
  for (const match of body.matchAll(linkPattern)) {
    const index = match.index ?? 0;
    content += htmlEscape(body.slice(cursor, index));
    content += `<a href="${htmlEscape(match[2])}">${htmlEscape(match[1])}</a>`;
    cursor = index + match[0].length;
  }
  content += htmlEscape(body.slice(cursor));
  return `<div style="font-family:Arial,sans-serif;white-space:pre-wrap">${content}</div>`;
}

function mimeMessage(input: { to: string | null; subject: string; body: string }) {
  const safeSubject = input.subject.replace(/[\r\n]/g, " ");
  const lines = [
    ...(input.to ? [`To: ${input.to}`] : []),
    `Subject: =?UTF-8?B?${Buffer.from(safeSubject, "utf8").toString("base64")}?=`,
    "MIME-Version: 1.0",
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(bodyAsHtml(input.body), "utf8").toString("base64").replace(/.{1,76}/g, "$&\r\n").trim(),
  ];
  return Buffer.from(lines.join("\r\n"), "utf8").toString("base64url");
}

export async function saveDraftToGmail(input: {
  userId: string;
  localDraftId: string;
  gmailDraftId: string | null;
  recipientEmail: string | null;
  subject: string;
  body: string;
}) {
  if (input.recipientEmail && !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(input.recipientEmail)) {
    throw new Error("The opportunity's contact email is not a valid recipient address. Edit the contact before saving to Gmail.");
  }
  const token = await accessToken(input.userId);
  const connection = await getConnection(input.userId);
  const method = input.gmailDraftId ? "PUT" : "POST";
  const endpoint = input.gmailDraftId
    ? `https://gmail.googleapis.com/gmail/v1/users/me/drafts/${encodeURIComponent(input.gmailDraftId)}`
    : "https://gmail.googleapis.com/gmail/v1/users/me/drafts";
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ...(input.gmailDraftId ? { id: input.gmailDraftId } : {}), message: { raw: mimeMessage({ to: input.recipientEmail, subject: input.subject, body: input.body }) } }),
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
    });
  } catch {
    throw new GmailOperationError("Could not reach the Gmail API. Check the server's internet connection and try again.", "gmail_api", 502);
  }
  const payload = await response.json().catch(() => ({})) as {
    id?: unknown;
    error?: { message?: unknown; status?: unknown; errors?: Array<{ reason?: unknown; message?: unknown }> };
  };
  if (!response.ok || typeof payload.id !== "string") {
    const providerReason = payload.error?.errors?.find((item) => typeof item.reason === "string")?.reason;
    const reason = typeof providerReason === "string" ? ` [${providerReason}]` : "";
    const detail = typeof payload.error?.message === "string" ? payload.error.message.replace(/[\r\n]/g, " ").slice(0, 180) : "Gmail rejected the draft.";
    const permissionHint = response.status === 403 ? " Check that the Gmail API is enabled and reconnect with the Gmail compose permission." : "";
    throw new GmailOperationError(`Gmail API could not save the draft (HTTP ${response.status})${reason}: ${detail}.${permissionHint}`, "gmail_api", response.status >= 500 ? 502 : response.status);
  }
  await query('UPDATE "EmailDraft" SET "gmailDraftId"=$1,"savedToGmailAt"=NOW(),"updatedAt"=NOW() WHERE "id"=$2 AND "userId"=$3', [payload.id, input.localDraftId, input.userId]);
  return { gmailDraftId: payload.id, accountEmail: connection?.accountEmail ?? null };
}
