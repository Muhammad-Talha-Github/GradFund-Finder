import { readFile } from "node:fs/promises";
import path from "node:path";
import { loadEnvConfig } from "@next/env";
import { createDatabase } from "../lib/db";

loadEnvConfig(process.cwd());

async function removeLegacyRegistry(db: ReturnType<typeof createDatabase>) {
  const constraints = await db.query<{ tableName: string; constraintName: string }>(
    `SELECT TABLE_NAME AS tableName, CONSTRAINT_NAME AS constraintName
     FROM information_schema.KEY_COLUMN_USAGE
     WHERE TABLE_SCHEMA=DATABASE() AND REFERENCED_TABLE_NAME IN ('Source','DiscoveryQuery')`,
  );
  for (const { tableName, constraintName } of constraints.rows) {
    const quote = (identifier: string) => `\`${identifier.replace(/\`/g, "\`\`")}\``;
    await db.query(`ALTER TABLE ${quote(tableName)} DROP FOREIGN KEY ${quote(constraintName)}`);
  }

  const legacyColumns = [
    ["Opportunity", "sourceId"],
    ["OpportunitySource", "sourceId"],
    ["DiscoveryCandidate", "sourceId"],
    ["DiscoveryCandidate", "queryId"],
  ];
  for (const [tableName, columnName] of legacyColumns) {
    const exists = await db.query(
      `SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=$1 AND COLUMN_NAME=$2`,
      [tableName, columnName],
    );
    if (exists.rowCount) await db.query(`ALTER TABLE \`${tableName}\` DROP COLUMN \`${columnName}\``);
  }
  // Source registry entries and saved query rows are intentionally retired.
  // Opportunity/source URLs and discovery/crawl history live in other tables.
  await db.query("DROP TABLE IF EXISTS `DiscoveryQuery`");
  await db.query("DROP TABLE IF EXISTS `Source`");
}

async function addColumnIfMissing(db: ReturnType<typeof createDatabase>, tableName: string, columnName: string, definition: string) {
  const found = await db.query(
    `SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=$1 AND COLUMN_NAME=$2`,
    [tableName, columnName],
  );
  if (!found.rowCount) await db.query(`ALTER TABLE \`${tableName}\` ADD COLUMN \`${columnName}\` ${definition}`);
}

async function addIndexIfMissing(db: ReturnType<typeof createDatabase>, tableName: string, indexName: string, definition: string) {
  const found = await db.query(
    `SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=$1 AND INDEX_NAME=$2 LIMIT 1`,
    [tableName, indexName],
  );
  if (!found.rowCount) await db.query(`ALTER TABLE \`${tableName}\` ADD ${definition}`);
}

async function addForeignKeyIfMissing(db: ReturnType<typeof createDatabase>, tableName: string, constraintName: string, definition: string) {
  const found = await db.query(
    `SELECT 1 FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME=$1 AND CONSTRAINT_NAME=$2 LIMIT 1`,
    [tableName, constraintName],
  );
  if (!found.rowCount) await db.query(`ALTER TABLE \`${tableName}\` ADD CONSTRAINT \`${constraintName}\` ${definition}`);
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("Set DATABASE_URL to a mysql:// URL in .env.local before initializing the database.");
  const db = createDatabase(process.env.DATABASE_URL, { connectionLimit: 1 });
  try {
    const schema = await readFile(path.join(process.cwd(), "db", "schema.mysql.sql"), "utf8");
    for (const statement of schema.split(";").map((part) => part.trim()).filter(Boolean)) await db.query(statement);
    // Safe, additive migration for existing draft rows. Never drops or rewrites them.
    await addColumnIfMissing(db, "EmailDraft", "recipientEmail", "VARCHAR(320) NULL AFTER `recipientName`");
    await addColumnIfMissing(db, "EmailDraft", "gmailDraftId", "VARCHAR(255) NULL AFTER `body`");
    await addColumnIfMissing(db, "EmailDraft", "savedToGmailAt", "DATETIME(3) NULL AFTER `gmailDraftId`");
    await addColumnIfMissing(db, "EmailDraft", "userId", "VARCHAR(36) NULL AFTER `savedToGmailAt`");
    await addColumnIfMissing(db, "EmailSettings", "userId", "VARCHAR(36) NULL AFTER `applicantContext`");
    await addColumnIfMissing(db, "GmailConnection", "userId", "VARCHAR(36) NULL AFTER `accountEmail`");
    await addIndexIfMissing(db, "EmailSettings", "email_settings_user_unique", "UNIQUE KEY `email_settings_user_unique` (`userId`)");
    await addIndexIfMissing(db, "GmailConnection", "gmail_connection_user_unique", "UNIQUE KEY `gmail_connection_user_unique` (`userId`)");
    await addForeignKeyIfMissing(db, "EmailDraft", "email_draft_user_fk", "FOREIGN KEY (`userId`) REFERENCES `AppUser` (`id`) ON DELETE CASCADE ON UPDATE CASCADE");
    await addForeignKeyIfMissing(db, "EmailSettings", "email_settings_user_fk", "FOREIGN KEY (`userId`) REFERENCES `AppUser` (`id`) ON DELETE CASCADE ON UPDATE CASCADE");
    await addForeignKeyIfMissing(db, "GmailConnection", "gmail_connection_user_fk", "FOREIGN KEY (`userId`) REFERENCES `AppUser` (`id`) ON DELETE CASCADE ON UPDATE CASCADE");
    await removeLegacyRegistry(db);
    console.log("MySQL schema is ready. Legacy source/query registries were removed; opportunity and discovered URL records were preserved.");
  } finally { await db.end(); }
}

main().catch((error: unknown) => {
  console.error("MySQL initialization failed:", error instanceof Error ? error.message : "Unknown error");
  process.exitCode = 1;
});
