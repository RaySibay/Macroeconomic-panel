from __future__ import annotations

import argparse
import json
import re
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable

import pandas as pd
import requests


@dataclass(frozen=True)
class SeriesSpec:
    name: str
    date_patterns: tuple[str, ...]
    value_patterns: tuple[str, ...]
    reject_patterns: tuple[str, ...] = ()


M1_SPEC = SeriesSpec(
    name="M1同比",
    date_patterns=("月份", "日期", "统计时间", "date", "month", "time"),
    value_patterns=("M1.*同比", "M1.*增长", "M1.*增速", "狭义货币.*同比", "m1.*yoy", "m1"),
    reject_patterns=("M0", "M2", "余额", "数量"),
)

PPI_SPEC = SeriesSpec(
    name="PPI同比",
    date_patterns=("月份", "日期", "统计时间", "date", "month", "time"),
    value_patterns=("今值", "PPI.*同比", "工业品出厂价格.*同比", "生产者价格.*同比", "value", "actual"),
    reject_patterns=("预测", "前值", "forecast", "previous"),
)

IP_SPEC = SeriesSpec(
    name="工业增加值同比",
    date_patterns=("月份", "日期", "统计时间", "date", "month", "time"),
    value_patterns=("今值", "工业增加值.*同比", "规模以上工业.*同比", "value", "actual"),
    reject_patterns=("预测", "前值", "forecast", "previous"),
)

CHINA_GOLD_RESERVE_SPEC = SeriesSpec(
    name="中国央行黄金储备",
    date_patterns=("月份", "日期", "统计时间", "date", "month", "time"),
    value_patterns=("黄金.*储备", "黄金", "万盎司", "value", "reserve"),
    reject_patterns=("同比", "环比", "预测", "前值", "forecast", "previous"),
)

SPDR_GOLD_ETF_SPEC = SeriesSpec(
    name="SPDR黄金ETF持仓",
    date_patterns=("日期", "月份", "统计时间", "date", "time"),
    value_patterns=("持仓", "总库存", "库存", "吨", "ton", "tonne", "value", "spdr"),
    reject_patterns=("变动", "增减", "涨跌", "change", "pct", "%"),
)


def main() -> None:
    args = parse_args()
    rows = build_rows(args)
    china_gold_reserve_rows = build_china_gold_reserve_rows(args)
    spdr_gold_etf_rows = build_spdr_gold_etf_rows(args)
    payload = {
        "message": f"refresh_data.py {datetime.now(timezone.utc).isoformat()}",
        "rows": rows,
        "chinaGoldReserveRows": china_gold_reserve_rows,
        "spdrGoldEtfRows": spdr_gold_etf_rows,
    }

    if args.out:
        out = Path(args.out)
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    if args.worker_url and args.token and not args.dry_run:
        post_to_worker(args.worker_url, args.token, payload)
    else:
        latest = rows[-1]["date"] if rows else "n/a"
        print(json.dumps({"rows": len(rows), "latestDate": latest, "posted": False}, ensure_ascii=False))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Refresh China free liquidity data and post it to Cloudflare Workers.")
    parser.add_argument("--worker-url", help="Worker origin, for example https://china-free-liquidity.example.workers.dev")
    parser.add_argument("--token", help="Bearer token matching Cloudflare Worker INGEST_TOKEN")
    parser.add_argument("--out", default="data/latest.json", help="Write the generated payload to this JSON file")
    parser.add_argument("--msci-csv", help="CSV containing official/licensed MSCI China index levels")
    parser.add_argument("--msci-symbol", default="MCHI", help="Yahoo Finance symbol used as public proxy when no CSV is supplied")
    parser.add_argument("--start", default="2003-01-01", help="Earliest month to include")
    parser.add_argument(
        "--gold-start",
        default=months_ago_start(60),
        help="Earliest China gold reserve month to include; defaults to the latest 60 months",
    )
    parser.add_argument(
        "--spdr-start",
        default=months_ago_start(24),
        help="Earliest SPDR gold ETF day to include; defaults to the latest 24 months",
    )
    parser.add_argument("--dry-run", action="store_true", help="Do not POST to Worker")
    return parser.parse_args()


def build_rows(args: argparse.Namespace) -> list[dict]:
    macro = fetch_macro_data()
    msci = read_msci_csv(args.msci_csv) if args.msci_csv else fetch_yahoo_monthly_yoy(args.msci_symbol, args.start)

    merged = macro.merge(msci, how="left", on="date").sort_values("date")
    merged = merged[merged["date"] >= month_start(args.start)]
    rows = []
    for item in merged.to_dict(orient="records"):
        rows.append(
            {
                "date": item["date"].strftime("%Y-%m-01"),
                "m1Yoy": clean_float(item.get("m1Yoy")),
                "ppiYoy": clean_float(item.get("ppiYoy")),
                "industrialProductionYoy": clean_float(item.get("industrialProductionYoy")),
                "msciChinaValue": clean_float(item.get("msciChinaValue")),
                "msciChinaYoy": clean_float(item.get("msciChinaYoy")),
            }
        )
    return rows


def fetch_macro_data() -> pd.DataFrame:
    import akshare as ak

    m1 = normalize_akshare_frame(ak.macro_china_money_supply(), M1_SPEC).rename(columns={"value": "m1Yoy"})
    ppi = normalize_monthly_ppi(ak.macro_china_ppi()).rename(columns={"value": "ppiYoy"})
    ip = normalize_monthly_industrial_production(ak.macro_china_gyzjz()).rename(
        columns={"value": "industrialProductionYoy"}
    )

    macro = m1.merge(ppi, how="outer", on="date").merge(ip, how="outer", on="date").sort_values("date")
    return macro.drop_duplicates(subset=["date"], keep="last")


def normalize_monthly_ppi(frame: pd.DataFrame) -> pd.DataFrame:
    date_col = pick_column(frame.columns, ("月份", "date", "month", "time"))
    value_col = pick_column(frame.columns, ("当月同比增长", "PPI.*同比", "同比增长", "value", "actual"))

    result = frame[[date_col, value_col]].copy()
    result.columns = ["date", "value"]
    result["date"] = result["date"].map(month_start)
    result["value"] = result["value"].map(parse_number)
    result = result.dropna(subset=["date", "value"]).sort_values("date")
    if result.empty:
        raise RuntimeError(f"PPI同比 could not be normalized from columns: {list(frame.columns)}")
    return result


def normalize_monthly_industrial_production(frame: pd.DataFrame) -> pd.DataFrame:
    date_col = pick_column(frame.columns, ("月份", "date", "month", "time"))
    value_col = pick_column(frame.columns, ("同比增长", "工业增加值.*同比", "value", "actual"), ("累计",))
    cumulative_col = pick_column(frame.columns, ("累计增长", "累计.*同比", "cumulative"))

    result = frame[[date_col, value_col, cumulative_col]].copy()
    result.columns = ["date", "value", "cumulativeValue"]
    result["date"] = result["date"].map(month_start)
    result["value"] = result["value"].map(parse_number)
    result["cumulativeValue"] = result["cumulativeValue"].map(parse_number)

    february_mask = result["date"].map(lambda value: value is not None and value.month == 2)
    result.loc[february_mask & result["value"].isna(), "value"] = result.loc[
        february_mask & result["value"].isna(), "cumulativeValue"
    ]

    result = result.drop(columns=["cumulativeValue"]).dropna(subset=["date", "value"]).sort_values("date")
    if result.empty:
        raise RuntimeError(f"工业增加值同比 could not be normalized from columns: {list(frame.columns)}")
    return result


def build_china_gold_reserve_rows(args: argparse.Namespace) -> list[dict]:
    import akshare as ak

    gold = normalize_akshare_frame(ak.macro_china_foreign_exchange_gold(), CHINA_GOLD_RESERVE_SPEC).rename(
        columns={"value": "reserve10kOz"}
    )
    gold = gold.drop_duplicates(subset=["date"], keep="last").sort_values("date")
    gold["monthlyChange10kOz"] = gold["reserve10kOz"].diff()
    gold = gold[gold["date"] >= month_start(args.gold_start)]
    rows = []
    for item in gold.to_dict(orient="records"):
        rows.append(
            {
                "date": item["date"].strftime("%Y-%m-01"),
                "reserve10kOz": clean_float(item.get("reserve10kOz")),
                "monthlyChange10kOz": clean_float(item.get("monthlyChange10kOz")),
            }
        )
    return rows


def build_spdr_gold_etf_rows(args: argparse.Namespace) -> list[dict]:
    import akshare as ak

    spdr = normalize_akshare_frame(ak.macro_cons_gold(), SPDR_GOLD_ETF_SPEC, date_mapper=day_start).rename(
        columns={"value": "holdingTonnes"}
    )
    spdr = spdr.drop_duplicates(subset=["date"], keep="last").sort_values("date")
    spdr["dailyChangeTonnes"] = spdr["holdingTonnes"].diff()
    spdr = spdr[spdr["date"] >= day_start(args.spdr_start)]
    rows = []
    for item in spdr.to_dict(orient="records"):
        rows.append(
            {
                "date": item["date"].strftime("%Y-%m-%d"),
                "holdingTonnes": clean_float(item.get("holdingTonnes")),
                "dailyChangeTonnes": clean_float(item.get("dailyChangeTonnes")),
            }
        )
    return rows


def normalize_akshare_frame(frame: pd.DataFrame, spec: SeriesSpec, date_mapper=None) -> pd.DataFrame:
    if frame.empty:
        raise RuntimeError(f"{spec.name} returned an empty frame")

    if date_mapper is None:
        date_mapper = month_start

    date_col = pick_column(frame.columns, spec.date_patterns)
    value_col = pick_column(frame.columns, spec.value_patterns, spec.reject_patterns)
    result = frame[[date_col, value_col]].copy()
    result.columns = ["date", "value"]
    result["date"] = result["date"].map(date_mapper)
    result["value"] = result["value"].map(parse_number)
    result = result.dropna(subset=["date", "value"]).sort_values("date")

    if result.empty:
        raise RuntimeError(f"{spec.name} could not be normalized from columns: {list(frame.columns)}")
    return result


def pick_column(columns: Iterable[str], patterns: tuple[str, ...], rejects: tuple[str, ...] = ()) -> str:
    names = [str(column) for column in columns]
    reject_re = re.compile("|".join(rejects), re.I) if rejects else None

    for pattern in patterns:
      regex = re.compile(pattern, re.I)
      matches = [name for name in names if regex.search(name) and not (reject_re and reject_re.search(name))]
      if matches:
          return matches[0]

    raise RuntimeError(f"Could not find column matching {patterns}; available columns: {names}")


def read_msci_csv(path: str) -> pd.DataFrame:
    frame = pd.read_csv(path)
    date_col = pick_column(frame.columns, ("date", "日期", "month", "月份"))
    value_col = pick_column(frame.columns, ("close", "price", "index", "value", "收盘", "指数", "点位"))
    monthly = frame[[date_col, value_col]].copy()
    monthly.columns = ["date", "msciChinaValue"]
    monthly["date"] = monthly["date"].map(month_start)
    monthly["msciChinaValue"] = monthly["msciChinaValue"].map(parse_number)
    monthly = monthly.dropna(subset=["date", "msciChinaValue"]).sort_values("date")
    monthly = monthly.groupby("date", as_index=False).last()
    monthly["msciChinaYoy"] = monthly["msciChinaValue"] / monthly["msciChinaValue"].shift(12) * 100 - 100
    return monthly


def fetch_yahoo_monthly_yoy(symbol: str, start: str) -> pd.DataFrame:
    start_ts = int(month_start(start).timestamp())
    end_ts = int(time.time())
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"
    params = {
        "period1": start_ts,
        "period2": end_ts,
        "interval": "1d",
        "events": "history",
        "includeAdjustedClose": "true",
    }
    response = requests.get(url, params=params, timeout=30, headers={"user-agent": "china-free-liquidity-panel/1.0"})
    response.raise_for_status()
    payload = response.json()["chart"]["result"][0]
    timestamps = payload["timestamp"]
    quote = payload["indicators"]["quote"][0]
    adjclose = payload["indicators"].get("adjclose", [{}])[0].get("adjclose")
    values = adjclose or quote["close"]
    daily = pd.DataFrame(
        {
            "date": pd.to_datetime(timestamps, unit="s", utc=True).tz_convert(None),
            "msciChinaValue": values,
        }
    ).dropna()
    daily["date"] = daily["date"].dt.to_period("M").dt.to_timestamp()
    monthly = daily.groupby("date", as_index=False).last()
    monthly["msciChinaYoy"] = monthly["msciChinaValue"] / monthly["msciChinaValue"].shift(12) * 100 - 100
    return monthly


def post_to_worker(worker_url: str, token: str, payload: dict) -> None:
    endpoint = f"{worker_url.rstrip('/')}/api/ingest"
    response = requests.post(endpoint, json=payload, headers={"authorization": f"Bearer {token}"}, timeout=60)
    response.raise_for_status()
    print(response.text)


def month_start(value) -> pd.Timestamp | None:
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return None
    parsed = pd.to_datetime(str(value).strip().replace("/", "-"), errors="coerce")
    if pd.isna(parsed):
        match = re.search(r"(\d{4})\D?(\d{1,2})", str(value))
        if not match:
            return None
        parsed = pd.Timestamp(year=int(match.group(1)), month=int(match.group(2)), day=1)
    return pd.Timestamp(year=parsed.year, month=parsed.month, day=1)


def day_start(value) -> pd.Timestamp | None:
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return None
    parsed = pd.to_datetime(str(value).strip().replace("/", "-"), errors="coerce")
    if pd.isna(parsed):
        return None
    return pd.Timestamp(year=parsed.year, month=parsed.month, day=parsed.day)


def months_ago_start(months: int) -> str:
    now = datetime.now(timezone.utc)
    month_index = now.year * 12 + now.month - 1 - months
    year = month_index // 12
    month = month_index % 12 + 1
    return f"{year:04d}-{month:02d}-01"


def parse_number(value) -> float | None:
    if value is None or pd.isna(value):
        return None
    if isinstance(value, (int, float)):
        return float(value)
    text = str(value).strip().replace("%", "").replace(",", "")
    if not text or text in {"--", "-", "nan", "None"}:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def clean_float(value) -> float | None:
    if value is None or pd.isna(value):
        return None
    return round(float(value), 4)


if __name__ == "__main__":
    main()
