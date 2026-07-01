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

CREATE TABLE IF NOT EXISTS refresh_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  status TEXT NOT NULL,
  message TEXT,
  rows_received INTEGER,
  data_through TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
