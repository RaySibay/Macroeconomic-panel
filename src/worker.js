import { computeFreeLiquidityRows, round, toMonth } from "./compute.js";
import { SAMPLE_ROWS } from "./sample-data.js";

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "public, max-age=300",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "authorization, content-type"
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: JSON_HEADERS });
    }

    if (url.pathname === "/api/health") {
      return json({ ok: true, hasDb: Boolean(env.DB), now: new Date().toISOString() });
    }

    if (url.pathname === "/api/series" && request.method === "GET") {
      return json(await getSeries(env, url));
    }

    if (url.pathname === "/api/ingest" && request.method === "POST") {
      return handleIngest(request, env);
    }

    if (env.ASSETS) {
      return env.ASSETS.fetch(request);
    }

    return new Response("Not found", { status: 404 });
  }
};

function json(payload, init = {}) {
  return new Response(JSON.stringify(payload), {
    ...init,
    headers: { ...JSON_HEADERS, ...(init.headers ?? {}) }
  });
}

async function getSeries(env, url) {
  const from = toMonth(url.searchParams.get("from"));
  const to = toMonth(url.searchParams.get("to"));
  let source = "sample";
  let rows = SAMPLE_ROWS;

  if (env.DB) {
    const filters = [];
    const params = [];
    if (from) {
      filters.push("obs_date >= ?");
      params.push(from);
    }
    if (to) {
      filters.push("obs_date <= ?");
      params.push(to);
    }

    const where = filters.length ? `WHERE ${filters.join(" AND ")}` : "";
    const result = await env.DB.prepare(
      `SELECT
        obs_date AS date,
        m1_yoy AS m1Yoy,
        ppi_yoy AS ppiYoy,
        industrial_production_yoy AS industrialProductionYoy,
        industrial_production_yoy_3m AS industrialProductionYoy3m,
        free_liquidity AS freeLiquidity,
        msci_china_value AS msciChinaValue,
        msci_china_yoy AS msciChinaYoy,
        updated_at AS updatedAt
      FROM series_points
      ${where}
      ORDER BY obs_date`
    )
      .bind(...params)
      .all();

    if (result.results?.length) {
      source = "d1";
      rows = result.results.map(cleanRow);
    }
  }

  if (source === "sample") {
    rows = rows.filter((row) => (!from || row.date >= from) && (!to || row.date <= to));
  }

  const latest = [...rows].reverse().find((row) => row.freeLiquidity !== null || row.msciChinaYoy !== null) ?? null;

  return {
    rows,
    meta: {
      source,
      latestDate: latest?.date ?? null,
      formula: "freeLiquidity = M1 YoY - PPI YoY - 3M average industrial production YoY",
      msciNote:
        "The ingestion script defaults to MCHI as a public proxy unless an official MSCI China CSV is supplied."
    }
  };
}

async function handleIngest(request, env) {
  if (!env.DB) return json({ ok: false, error: "D1 binding DB is not configured" }, { status: 500 });

  const expectedToken = env.INGEST_TOKEN;
  if (!expectedToken) return json({ ok: false, error: "INGEST_TOKEN is not configured" }, { status: 500 });

  const actualToken = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (actualToken !== expectedToken) return json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const payload = await request.json();
  const incomingRows = Array.isArray(payload.rows) ? payload.rows : [];
  if (!incomingRows.length) return json({ ok: false, error: "Payload must include rows[]" }, { status: 400 });

  const computed = computeFreeLiquidityRows(incomingRows);
  const statements = computed.map((row) =>
    env.DB.prepare(
      `INSERT INTO series_points (
        obs_date,
        m1_yoy,
        ppi_yoy,
        industrial_production_yoy,
        industrial_production_yoy_3m,
        free_liquidity,
        msci_china_value,
        msci_china_yoy,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(obs_date) DO UPDATE SET
        m1_yoy = excluded.m1_yoy,
        ppi_yoy = excluded.ppi_yoy,
        industrial_production_yoy = excluded.industrial_production_yoy,
        industrial_production_yoy_3m = excluded.industrial_production_yoy_3m,
        free_liquidity = excluded.free_liquidity,
        msci_china_value = excluded.msci_china_value,
        msci_china_yoy = excluded.msci_china_yoy,
        updated_at = CURRENT_TIMESTAMP`
    ).bind(
      row.date,
      row.m1Yoy,
      row.ppiYoy,
      row.industrialProductionYoy,
      row.industrialProductionYoy3m,
      row.freeLiquidity,
      row.msciChinaValue,
      row.msciChinaYoy
    )
  );

  await env.DB.batch(statements);

  const latestDate = computed.at(-1)?.date ?? null;
  await env.DB.prepare(
    "INSERT INTO refresh_log (status, message, rows_received, data_through) VALUES (?, ?, ?, ?)"
  )
    .bind("ok", payload.message ?? "ingest completed", computed.length, latestDate)
    .run();

  return json(
    {
      ok: true,
      rowsReceived: computed.length,
      latestDate
    },
    { headers: { "cache-control": "no-store" } }
  );
}

function cleanRow(row) {
  return {
    date: row.date,
    m1Yoy: round(row.m1Yoy),
    ppiYoy: round(row.ppiYoy),
    industrialProductionYoy: round(row.industrialProductionYoy),
    industrialProductionYoy3m: round(row.industrialProductionYoy3m),
    freeLiquidity: round(row.freeLiquidity),
    msciChinaValue: round(row.msciChinaValue),
    msciChinaYoy: round(row.msciChinaYoy),
    updatedAt: row.updatedAt
  };
}
