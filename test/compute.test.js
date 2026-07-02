import test from "node:test";
import assert from "node:assert/strict";

import { asNumber, computeFreeLiquidityRows, computeMonthlyYoy, toMonth } from "../src/compute.js";

test("normalizes month strings and numeric values", () => {
  assert.equal(toMonth("2026/04/30"), "2026-04-01");
  assert.equal(toMonth("202604"), "2026-04-01");
  assert.equal(asNumber(" 1,234.5% "), 1234.5);
  assert.equal(asNumber("--"), null);
});

test("computes 3-month industrial production average and free liquidity", () => {
  const rows = computeFreeLiquidityRows([
    { date: "2026-01-01", m1Yoy: 8, ppiYoy: 1, industrialProductionYoy: 3 },
    { date: "2026-02-01", m1Yoy: 9, ppiYoy: 1, industrialProductionYoy: 6 },
    { date: "2026-03-01", m1Yoy: 10, ppiYoy: 1, industrialProductionYoy: 9 }
  ]);

  assert.equal(rows[0].freeLiquidity, null);
  assert.equal(rows[2].industrialProductionYoy3m, 6);
  assert.equal(rows[2].freeLiquidity, 3);
});

test("skips missing industrial production values in the 3-observation average", () => {
  const rows = computeFreeLiquidityRows([
    { date: "2025-12-01", m1Yoy: 8, ppiYoy: 1, industrialProductionYoy: 3 },
    { date: "2026-01-01", m1Yoy: 9, ppiYoy: 1, industrialProductionYoy: 6 },
    { date: "2026-02-01", m1Yoy: 10, ppiYoy: 1, industrialProductionYoy: null },
    { date: "2026-03-01", m1Yoy: 11, ppiYoy: 1, industrialProductionYoy: 9 }
  ]);

  assert.equal(rows[3].industrialProductionYoy3m, 6);
  assert.equal(rows[3].freeLiquidity, 4);
});

test("computes monthly year-over-year percentage change", () => {
  const prices = computeMonthlyYoy([
    { date: "2025-01-31", value: 100 },
    { date: "2026-01-31", value: 110 }
  ]);

  assert.equal(prices[0].yoy, null);
  assert.equal(prices[1].yoy, 10);
});
