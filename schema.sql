CREATE TABLE IF NOT EXISTS series_points (
  obs_date TEXT PRIMARY KEY,
  m1_yoy REAL,
  ppi_yoy REAL,
  industrial_production_yoy REAL,
  industrial_production_yoy_3m REAL,
  free_liquidity REAL,
  msci_china_value REAL,
  msci_china_yoy REAL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_series_points_updated_at
  ON series_points(updated_at);

CREATE TABLE IF NOT EXISTS china_gold_reserve_points (
  obs_date TEXT PRIMARY KEY,
  reserve_10k_oz REAL,
  monthly_change_10k_oz REAL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_china_gold_reserve_points_updated_at
  ON china_gold_reserve_points(updated_at);

CREATE TABLE IF NOT EXISTS spdr_gold_etf_points (
  obs_date TEXT PRIMARY KEY,
  holding_tonnes REAL,
  daily_change_tonnes REAL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_spdr_gold_etf_points_updated_at
  ON spdr_gold_etf_points(updated_at);

CREATE TABLE IF NOT EXISTS refresh_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  status TEXT NOT NULL,
  message TEXT,
  rows_received INTEGER,
  data_through TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
