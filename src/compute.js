const MONTH_RE = /^\d{4}-\d{2}(-\d{2})?$/;

export function toMonth(value) {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date && !Number.isNaN(value.valueOf())) {
    return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, "0")}-01`;
  }

  const text = String(value).trim().replace(/\//g, "-");
  if (MONTH_RE.test(text)) return `${text.slice(0, 7)}-01`;

  const compact = text.match(/^(\d{4})(\d{2})(\d{2})?$/);
  if (compact) return `${compact[1]}-${compact[2]}-01`;

  const parsed = new Date(text);
  if (!Number.isNaN(parsed.valueOf())) {
    return `${parsed.getUTCFullYear()}-${String(parsed.getUTCMonth() + 1).padStart(2, "0")}-01`;
  }

  return null;
}

export function asNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const normalized = String(value).replace(/[% ,]/g, "").trim();
  if (!normalized || normalized === "--" || normalized.toLowerCase() === "nan") return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function round(value, digits = 4) {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

export function computeFreeLiquidityRows(rawRows) {
  const rows = rawRows
    .map((row) => ({
      date: toMonth(row.date ?? row.obs_date),
      m1Yoy: asNumber(row.m1Yoy ?? row.m1_yoy),
      ppiYoy: asNumber(row.ppiYoy ?? row.ppi_yoy),
      industrialProductionYoy: asNumber(
        row.industrialProductionYoy ?? row.industrial_production_yoy ?? row.ipYoy
      ),
      msciChinaValue: asNumber(row.msciChinaValue ?? row.msci_china_value),
      msciChinaYoy: asNumber(row.msciChinaYoy ?? row.msci_china_yoy)
    }))
    .filter((row) => row.date)
    .sort((a, b) => a.date.localeCompare(b.date));

  return rows.map((row, index) => {
    const ipWindow = rows
      .slice(Math.max(0, index - 2), index + 1)
      .map((item) => item.industrialProductionYoy)
      .filter((value) => value !== null);
    const industrialProductionYoy3m =
      ipWindow.length === 3 ? ipWindow.reduce((sum, value) => sum + value, 0) / 3 : null;
    const freeLiquidity =
      row.m1Yoy !== null && row.ppiYoy !== null && industrialProductionYoy3m !== null
        ? row.m1Yoy - row.ppiYoy - industrialProductionYoy3m
        : null;

    return {
      ...row,
      industrialProductionYoy3m: round(industrialProductionYoy3m),
      freeLiquidity: round(freeLiquidity)
    };
  });
}

export function computeMonthlyYoy(priceRows) {
  const monthly = new Map();

  for (const row of priceRows) {
    const date = toMonth(row.date);
    const value = asNumber(row.value ?? row.close ?? row.price);
    if (!date || value === null) continue;
    monthly.set(date, { date, value });
  }

  const rows = [...monthly.values()].sort((a, b) => a.date.localeCompare(b.date));
  const byDate = new Map(rows.map((row) => [row.date, row.value]));

  return rows.map((row) => {
    const yearAgo = `${Number(row.date.slice(0, 4)) - 1}${row.date.slice(4)}`;
    const previous = byDate.get(yearAgo);
    return {
      date: row.date,
      value: round(row.value),
      yoy: previous ? round((row.value / previous - 1) * 100) : null
    };
  });
}
