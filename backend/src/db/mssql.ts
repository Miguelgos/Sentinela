import sql from "mssql";

// Cacheamos a Promise (não o pool resolvido) pra evitar race em cold start:
// duas chamadas concorrentes vão aguardar o mesmo connect() em vez de criar
// dois pools.
let poolPromise: Promise<sql.ConnectionPool> | null = null;

export async function getMssqlPool(): Promise<sql.ConnectionPool> {
  if (poolPromise) {
    const p = await poolPromise;
    if (p.connected) return p;
    poolPromise = null;
  }

  const connStr = process.env["ConnectionStrings__ITURANWEB"];
  const config: sql.config | string = connStr ?? {
    server:   process.env.MSSQL_SERVER   || "BRSPO1IDB11.ITURAN.SP",
    database: process.env.MSSQL_DATABASE || "ituranweb",
    options: {
      instanceName:           process.env.MSSQL_INSTANCE || "INTEGRA_ESPELHO",
      trustServerCertificate: true,
      encrypt: false,
    },
    authentication: {
      type: "default",
      options: {
        userName: process.env.MSSQL_USER     || "",
        password: process.env.MSSQL_PASSWORD || "",
      },
    },
    pool: { max: 10, idleTimeoutMillis: 30_000 },
  };
  poolPromise = new sql.ConnectionPool(config).connect();
  return poolPromise;
}

export async function lookupPessoas(
  cdPessoas: string[]
): Promise<Record<string, string>> {
  if (cdPessoas.length === 0) return {};

  const unique = [...new Set(cdPessoas.filter(Boolean).map(Number).filter((n) => !isNaN(n)))];
  if (unique.length === 0) return {};

  const pool = await getMssqlPool();
  const req = pool.request();

  const placeholders = unique.map((id, i) => {
    req.input(`id${i}`, sql.Int, id);
    return `@id${i}`;
  });

  const result = await req.query<{ cd_pessoa: number; nm_pessoa: string }>(
    `SELECT cd_pessoa, nm_pessoa FROM pessoa WHERE cd_pessoa IN (${placeholders.join(",")})`
  );

  const map: Record<string, string> = {};
  for (const row of result.recordset) {
    map[String(row.cd_pessoa)] = row.nm_pessoa;
  }
  return map;
}
