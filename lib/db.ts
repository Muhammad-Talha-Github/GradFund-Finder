import { createPool, type Pool as MysqlPool, type PoolConnection } from "mysql2/promise";

export type QueryRow = Record<string, any>;
export type QueryResult<T extends QueryRow = QueryRow> = { rows: T[]; rowCount: number };

function mysqlOptions(connectionString: string) {
  let url: URL;
  try { url = new URL(connectionString); } catch { throw new Error("DATABASE_URL must be a valid mysql:// connection URL."); }
  if (url.protocol !== "mysql:") throw new Error("DATABASE_URL must use the mysql:// protocol.");
  return {
    host: url.hostname,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database: decodeURIComponent(url.pathname.replace(/^\//, "")),
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    timezone: "Z" as const,
    dateStrings: false,
    flags: ["FOUND_ROWS"],
  };
}

export function mysqlStatement(text: string, values: unknown[]) {
  let sql = text
    .replace(/gen_random_uuid\(\)\s*::\s*text/gi, "UUID()")
    .replace(/::(?:"[^"]+"|[a-z_][a-z_0-9]*)/gi, "")
    .replace(/\bILIKE\b/gi, "LIKE")
    .replace(/"([^"]+)"/g, "`$1`");
  const parameters: unknown[] = [];
  sql = sql.replace(/\$(\d+)/g, (_match, position: string) => {
    const index = Number(position) - 1;
    if (index < 0 || index >= values.length) throw new Error(`SQL parameter $${position} has no value.`);
    parameters.push(values[index]);
    return "?";
  });
  return { sql, parameters };
}

async function execute<T extends QueryRow>(connection: MysqlPool | PoolConnection, text: string, values: unknown[]): Promise<QueryResult<T>> {
  const { sql, parameters } = mysqlStatement(text, values);
  const [result] = await connection.execute(sql, parameters as never[]);
  if (Array.isArray(result)) return { rows: result as T[], rowCount: result.length };
  const header = result as { affectedRows?: number };
  return { rows: [], rowCount: header.affectedRows ?? 0 };
}

export class DatabaseNotConfiguredError extends Error {
  constructor() {
    super("MySQL is not configured. Set DATABASE_URL to a mysql:// URL and initialize the database.");
    this.name = "DatabaseNotConfiguredError";
  }
}

export class DatabaseConnection {
  constructor(private readonly connection: PoolConnection) {}
  query<T extends QueryRow = QueryRow>(text: string, values: unknown[] = []) { return execute<T>(this.connection, text, values); }
  beginTransaction() { return this.connection.beginTransaction(); }
  commit() { return this.connection.commit(); }
  rollback() { return this.connection.rollback(); }
  release() { this.connection.release(); }
}

export class DatabasePool {
  private readonly pool: MysqlPool;
  constructor(connectionString: string, options: { connectionLimit?: number } = {}) {
    this.pool = createPool({ ...mysqlOptions(connectionString), connectionLimit: options.connectionLimit ?? 10, connectTimeout: 5_000 });
  }
  query<T extends QueryRow = QueryRow>(text: string, values: unknown[] = []) { return execute<T>(this.pool, text, values); }
  async connect() { return new DatabaseConnection(await this.pool.getConnection()); }
  end() { return this.pool.end(); }
}

const globalForMysql = globalThis as unknown as { mysqlPool?: DatabasePool };

export function createDatabase(connectionString: string, options: { connectionLimit?: number } = {}) {
  return new DatabasePool(connectionString, options);
}

export function getDatabase(): DatabasePool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new DatabaseNotConfiguredError();
  if (!globalForMysql.mysqlPool) globalForMysql.mysqlPool = createDatabase(connectionString);
  return globalForMysql.mysqlPool;
}

export async function query<T extends QueryRow = QueryRow>(text: string, values: unknown[] = []) {
  return getDatabase().query<T>(text, values);
}

export async function inTransaction<T>(work: (client: DatabaseConnection) => Promise<T>): Promise<T> {
  const client = await getDatabase().connect();
  let transactionStarted = false;
  try {
    await client.beginTransaction();
    transactionStarted = true;
    const result = await work(client);
    await client.commit();
    return result;
  } catch (error) {
    if (transactionStarted) await client.rollback().catch(() => undefined);
    throw error;
  } finally { client.release(); }
}
