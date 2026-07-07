# China Free Liquidity Panel

静态前端 + Cloudflare Workers + D1 的中国自由流动性监测面板。指标逻辑参考研报口径：

```text
China Free Liquidity = M1 YoY - PPI YoY - 最近3个可用工业增加值 YoY 观测值移动平均
```

工业增加值在春节前后可能缺少单月观测，计算 3 个观测值均值时会跳过缺失月份，避免单个空值导致后续多个月折线断开。

前端展示自由流动性与 MSCI China 年同比走势，并在下方展示中国央行黄金储备月变化、SPDR 黄金 ETF 持仓日变化。由于 MSCI 指数本身通常涉及授权，采集脚本默认用 `MCHI` ETF 作为公开代理；如果你有正式 MSCI China 指数数据，可以用 `--msci-csv` 提供 CSV。

## 架构

- `public/`: 静态网页，直接由 Worker Assets 托管。
- `src/worker.js`: Worker API，提供 `/api/series` 和 `/api/ingest`。
- `schema.sql`: D1 数据库表结构。
- `scripts/refresh_data.py`: AKShare 数据采集器，计算前置数据并推送到 Worker。
- `.github/workflows/refresh.yml`: 可选的 GitHub Actions 工作日定时刷新任务。

Cloudflare Workers 已经支持 Python Workers，但官方文档仍标记为 beta，并且 Python 包支持有运行时限制。AKShare 依赖链较重，放在独立 Python 定时任务里更稳；Worker 负责鉴权、入库、API 和静态站点。

## 本地运行

```powershell
npm test
npm run dev:local
```

打开 `http://127.0.0.1:8787` 可以用内置样例数据预览页面。

如果要用 Wrangler 模拟 Cloudflare 运行环境：

```powershell
npm install
npm run dev
```

本地没有 D1 数据时，页面会显示内置样例数据。

## 部署 Cloudflare

1. 创建 D1 数据库：

```powershell
npx wrangler d1 create china-liquidity
```

2. 把返回的 `database_id` 写入 `wrangler.toml`。

3. 初始化表：

```powershell
npx wrangler d1 execute china-liquidity --file=./schema.sql
```

将初始化表同步到云端：

```powershell
npx wrangler d1 execute china-liquidity --remote --file=./schema.sql
```

后续如果已有 D1 数据库，也可以再次执行同一条命令补齐新增表；`CREATE TABLE IF NOT EXISTS` 不会删除已有数据。

4. 设置写入 token：

```powershell
npx wrangler secret put INGEST_TOKEN[这里填入你设置的数据更新密钥]
```

5. 部署：

```powershell
npm run deploy
```

## 刷新数据

安装 Python 依赖：

```powershell
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

使用 AKShare + MCHI 代理数据刷新：

```powershell
python scripts/refresh_data.py --worker-url https://your-worker.workers.dev --token <INGEST_TOKEN>
```

使用正式 MSCI China CSV：

```powershell
python scripts/refresh_data.py --msci-csv .\data\msci_china.csv --worker-url https://your-worker.workers.dev --token <INGEST_TOKEN>
```

CSV 需要包含日期列和指数点位列，脚本会自动匹配常见列名，例如 `date`、`close`、`index`、`value`、`日期`、`指数`。

黄金数据来自 AKShare：

- `ak.macro_china_foreign_exchange_gold()`: 中国央行黄金储备，脚本计算月度环比变化，默认只上传最近 60 个月的数据，可用 `--gold-start` 覆盖。
- `ak.macro_cons_gold()`: SPDR 黄金 ETF 持仓，脚本计算日度环比变化，默认只上传最近 24 个月的数据，可用 `--spdr-start` 覆盖。

## GitHub Actions 定时刷新

在仓库 Secrets 中设置：

- `WORKER_URL`: Worker 站点地址。注意请填入自动分配的workers.dev的域名，以防止Github Action被cloudflare盾拦截。
- `INGEST_TOKEN`: 与 Cloudflare Worker secret 相同的 token。

然后启用 `.github/workflows/refresh.yml`。默认北京时间工作日 17:30 运行一次，也可以手动触发。GitHub Actions cron 使用 UTC，因此配置为 `30 9 * * 1-5`。

如果 Actions 访问 `/api/health` 或 `/api/ingest` 时返回 Cloudflare `Just a moment...` / 403，说明请求被域名上的 Challenge、WAF 或 Bot 规则拦在 Worker 之前。优先把 `WORKER_URL` 指向未加挑战的 `workers.dev` 原始域名；如果必须使用自定义域名，则在 Cloudflare 为 `/api/*` 建立跳过 Challenge 的安全规则，并继续保留 Worker 的 `INGEST_TOKEN` 鉴权。

## API

读取数据：

```http
GET /api/series
GET /api/series?from=2021-01-01&to=2026-04-01
```

写入数据：

```http
POST /api/ingest
Authorization: Bearer <INGEST_TOKEN>
Content-Type: application/json

{
  "rows": [
    {
      "date": "2026-04-01",
      "m1Yoy": 0.8,
      "ppiYoy": -0.8,
      "industrialProductionYoy": 4.3,
      "msciChinaValue": 73.5,
      "msciChinaYoy": -6.0
    }
  ],
  "chinaGoldReserveRows": [
    {
      "date": "2026-04-01",
      "reserve10kOz": 7552,
      "monthlyChange10kOz": 14
    }
  ],
  "spdrGoldEtfRows": [
    {
      "date": "2026-04-30",
      "holdingTonnes": 920.1,
      "dailyChangeTonnes": 1.8
    }
  ]
}
```

Worker 会重新计算工业增加值 3 个月均值和自由流动性指标后入库；黄金储备和 SPDR 持仓变化量由采集脚本计算后入库。
