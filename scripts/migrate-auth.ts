import { loadEnvConfig } from "@next/env";
import { createDatabase } from "../lib/db";

loadEnvConfig(process.cwd());

async function hasRow(db: ReturnType<typeof createDatabase>, sql: string, values: unknown[]) {
  const result = await db.query(sql, values);
  return result.rowCount > 0;
}

async function addColumnIfMissing(db: ReturnType<typeof createDatabase>, table: string, column: string) {
  if (await hasRow(db,
    "SELECT 1 FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=$1 AND COLUMN_NAME=$2",
    [table, column])) return;
  await db.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` VARCHAR(36) NULL`);
}

async function addIndexIfMissing(db: ReturnType<typeof createDatabase>, table: string, name: string, definition: string) {
  if (await hasRow(db,
    "SELECT 1 FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=$1 AND INDEX_NAME=$2 LIMIT 1",
    [table, name])) return;
  await db.query(`ALTER TABLE \`${table}\` ADD ${definition}`);
}

async function addForeignKeyIfMissing(db: ReturnType<typeof createDatabase>, table: string, name: string, definition: string) {
  if (await hasRow(db,
    "SELECT 1 FROM information_schema.TABLE_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME=$1 AND CONSTRAINT_NAME=$2 LIMIT 1",
    [table, name])) return;
  await db.query(`ALTER TABLE \`${table}\` ADD CONSTRAINT \`${name}\` ${definition}`);
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("Set DATABASE_URL to a mysql:// URL in .env.local first.");
  const db = createDatabase(process.env.DATABASE_URL, { connectionLimit: 1 });
  try {
    await db.query(`CREATE TABLE IF NOT EXISTS \`AppUser\` (
      \`id\` VARCHAR(36) NOT NULL,
      \`username\` VARCHAR(30) NOT NULL,
      \`usernameLower\` VARCHAR(30) NOT NULL,
      \`email\` VARCHAR(320) NOT NULL,
      \`passwordHash\` VARCHAR(255) NOT NULL,
      \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`id\`),
      UNIQUE KEY \`app_user_username_unique\` (\`usernameLower\`),
      UNIQUE KEY \`app_user_email_unique\` (\`email\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`);
    await db.query(`CREATE TABLE IF NOT EXISTS \`AppSession\` (
      \`tokenHash\` CHAR(64) NOT NULL,
      \`userId\` VARCHAR(36) NOT NULL,
      \`expiresAt\` DATETIME(3) NOT NULL,
      \`createdAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`tokenHash\`),
      KEY \`app_session_user_expiry_idx\` (\`userId\`,\`expiresAt\`),
      CONSTRAINT \`app_session_user_fk\` FOREIGN KEY (\`userId\`) REFERENCES \`AppUser\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`);
    await db.query(`CREATE TABLE IF NOT EXISTS \`UserSavedOpportunity\` (
      \`userId\` VARCHAR(36) NOT NULL,
      \`opportunityId\` VARCHAR(36) NOT NULL,
      \`savedAt\` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
      PRIMARY KEY (\`userId\`,\`opportunityId\`),
      KEY \`user_saved_opportunity_idx\` (\`opportunityId\`),
      CONSTRAINT \`user_saved_user_fk\` FOREIGN KEY (\`userId\`) REFERENCES \`AppUser\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE,
      CONSTRAINT \`user_saved_opportunity_fk\` FOREIGN KEY (\`opportunityId\`) REFERENCES \`Opportunity\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`);

    await addColumnIfMissing(db, "EmailDraft", "userId");
    await addColumnIfMissing(db, "EmailSettings", "userId");
    await addColumnIfMissing(db, "GmailConnection", "userId");
    await addIndexIfMissing(db, "EmailSettings", "email_settings_user_unique", "UNIQUE KEY `email_settings_user_unique` (`userId`)");
    await addIndexIfMissing(db, "GmailConnection", "gmail_connection_user_unique", "UNIQUE KEY `gmail_connection_user_unique` (`userId`)");
    await addForeignKeyIfMissing(db, "EmailDraft", "email_draft_user_fk", "FOREIGN KEY (`userId`) REFERENCES `AppUser` (`id`) ON DELETE CASCADE ON UPDATE CASCADE");
    await addForeignKeyIfMissing(db, "EmailSettings", "email_settings_user_fk", "FOREIGN KEY (`userId`) REFERENCES `AppUser` (`id`) ON DELETE CASCADE ON UPDATE CASCADE");
    await addForeignKeyIfMissing(db, "GmailConnection", "gmail_connection_user_fk", "FOREIGN KEY (`userId`) REFERENCES `AppUser` (`id`) ON DELETE CASCADE ON UPDATE CASCADE");
    console.log("Authentication schema is ready. Existing records and unrelated tables were left untouched.");
  } finally { await db.end(); }
}

main().catch((error: unknown) => {
  console.error("Authentication schema migration failed:", error instanceof Error ? error.message : "Unknown error");
  process.exitCode = 1;
});
