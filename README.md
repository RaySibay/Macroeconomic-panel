# China Free Liquidity Panel

静态前端 + Cloudflare Workers + D1 的中国自由流动性监测面板。指标逻辑参考研报口径：

```text
China Free Liquidity = M1 YoY - PPI YoY - 3个月工业增加值 YoY 移动平均
```

前端展示自由流动性与 MSCI China 年同比走势。由于 MSCI 指数本身通常涉及授权，采集脚本默认用 `MCHI` ETF 作为公开代理；如果你有正式 MSCI China 指数数据，可以用 `--msci-csv` 提供 CSV。

## 架构

- `public/`: 静态网页，直接由 Worker Assets 托管。
- `src/worker.js`: Worker API，提供 `/api/series` 和 `/api/ingest`。
- `schema.sql`: D1 数据库表结构。
- `scripts/refresh_data.py`: AKShare 数据采集器，计算前置数据并推送到 Worker。
- `.github/workflows/refresh.yml`: 可选的 GitHub Actions 每日刷新任务。

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

4. 设置写入 token：

```powershell
npx wrangler secret put INGEST_TOKEN
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

## GitHub Actions 定时刷新

在仓库 Secrets 中设置：

- `WORKER_URL`: Worker 站点地址。
- `INGEST_TOKEN`: 与 Cloudflare Worker secret 相同的 token。

然后启用 `.github/workflows/refresh.yml`。默认每天 UTC 01:15 运行一次，也可以手动触发。

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
  ]
}
```

Worker 会重新计算工业增加值 3 个月均值和自由流动性指标后入库。
