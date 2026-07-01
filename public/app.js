const state = {
  rows: [],
  meta: {},
  range: "all"
};

const chart = document.querySelector("#chart");
const tooltip = document.querySelector("#tooltip");
const rowsBody = document.querySelector("#rowsBody");
const refreshButton = document.querySelector("#refreshButton");
const latestDate = document.querySelector("#latestDate");
const latestLiquidity = document.querySelector("#latestLiquidity");
const latestMsci = document.querySelector("#latestMsci");
const signalText = document.querySelector("#signalText");
const signalDetail = document.querySelector("#signalDetail");

const fmt = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 1, minimumFractionDigits: 1 });
const monthFmt = new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "short" });

document.querySelectorAll("[data-range]").forEach((button) => {
  button.addEventListener("click", () => {
    state.range = button.dataset.range;
    document.querySelectorAll("[data-range]").forEach((item) => item.classList.toggle("active", item === button));
    render();
  });
});

refreshButton.addEventListener("click", () => loadData());
window.addEventListener("resize", () => renderChart(filteredRows()));

await loadData();

async function loadData() {
  const response = await fetch("/api/series");
  if (!response.ok) throw new Error(`API ${response.status}`);
  const payload = await response.json();
  state.rows = payload.rows ?? [];
  state.meta = payload.meta ?? {};
  render();
}

function render() {
  const rows = filteredRows();
  renderMeta();
  renderChart(rows);
  renderTable(rows);
}

function filteredRows() {
  if (state.range === "all") return state.rows;
  const years = Number(state.range.replace("y", ""));
  const maxDate = state.rows.at(-1)?.date;
  if (!maxDate) return state.rows;
  const cutoff = new Date(`${maxDate}T00:00:00Z`);
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - years);
  return state.rows.filter((row) => new Date(`${row.date}T00:00:00Z`) >= cutoff);
}

function renderMeta() {
  const latest = [...state.rows].reverse().find((row) => row.freeLiquidity !== null || row.msciChinaYoy !== null);
  latestDate.textContent = latest ? monthFmt.format(new Date(`${latest.date}T00:00:00Z`)) : "--";
  latestLiquidity.textContent = formatPct(latest?.freeLiquidity);
  latestLiquidity.className = classFor(latest?.freeLiquidity);
  latestMsci.textContent = formatPct(latest?.msciChinaYoy);
  latestMsci.className = classFor(latest?.msciChinaYoy);

  const recent = state.rows.slice(-4).map((row) => row.freeLiquidity).filter((value) => value !== null);
  const slope = recent.length >= 2 ? recent.at(-1) - recent.at(0) : null;
  if (latest?.freeLiquidity === null || latest?.freeLiquidity === undefined) {
    signalText.textContent = "--";
    signalText.className = "";
    signalDetail.textContent = "等待数据";
  } else if (latest.freeLiquidity > 0 && slope !== null && slope > 0) {
    signalText.textContent = "扩张";
    signalText.className = "positive";
    signalDetail.textContent = "读数为正且近几个月改善";
  } else if (latest.freeLiquidity < 0 && slope !== null && slope < 0) {
    signalText.textContent = "收缩";
    signalText.className = "negative";
    signalDetail.textContent = "读数为负且近几个月走弱";
  } else {
    signalText.textContent = "震荡";
    signalText.className = "neutral";
    signalDetail.textContent = "方向未形成一致信号";
  }
}

function renderChart(rows) {
  const width = chart.clientWidth || 900;
  const height = chart.clientHeight || 420;
  const margin = { top: 18, right: 58, bottom: 48, left: 58 };
  const innerWidth = Math.max(1, width - margin.left - margin.right);
  const innerHeight = Math.max(1, height - margin.top - margin.bottom);
  const dates = rows.map((row) => new Date(`${row.date}T00:00:00Z`).getTime());
  const msciValues = rows.map((row) => row.msciChinaYoy).filter(isNum);
  const liquidityValues = rows.map((row) => row.freeLiquidity).filter(isNum);

  chart.setAttribute("viewBox", `0 0 ${width} ${height}`);
  chart.innerHTML = "";

  if (!rows.length || !msciValues.length || !liquidityValues.length) {
    text(chart, width / 2, height / 2, "暂无数据", "empty");
    return;
  }

  const xDomain = [Math.min(...dates), Math.max(...dates)];
  let msciDomain = paddedDomain(msciValues, 15);
  let liquidityDomain = paddedDomain(liquidityValues, 4);
  [msciDomain, liquidityDomain] = alignZeroDomains(msciDomain, liquidityDomain);
  const x = (value) => margin.left + ((value - xDomain[0]) / Math.max(1, xDomain[1] - xDomain[0])) * innerWidth;
  const yLeft = (value) =>
    margin.top + (1 - (value - msciDomain[0]) / Math.max(1, msciDomain[1] - msciDomain[0])) * innerHeight;
  const yRight = (value) =>
    margin.top + (1 - (value - liquidityDomain[0]) / Math.max(1, liquidityDomain[1] - liquidityDomain[0])) * innerHeight;

  const g = group(chart, "plot");
  for (const tick of ticks(msciDomain, 6)) {
    const y = yLeft(tick);
    line(g, margin.left, y, width - margin.right, y, "grid");
    text(g, margin.left - 10, y + 4, fmt.format(tick), "axis left-label");
  }
  for (const tick of ticks(liquidityDomain, 6)) {
    text(g, width - margin.right + 10, yRight(tick) + 4, fmt.format(tick), "axis right-label");
  }

  const zeroLeft = yLeft(0);
  if (zeroLeft >= margin.top && zeroLeft <= height - margin.bottom) {
    line(g, margin.left, zeroLeft, width - margin.right, zeroLeft, "zero");
  }

  const xTicks = pickTicks(rows, width < 700 ? 4 : 8);
  for (const row of xTicks) {
    const px = x(new Date(`${row.date}T00:00:00Z`).getTime());
    line(g, px, height - margin.bottom, px, height - margin.bottom + 5, "tick");
    text(g, px, height - margin.bottom + 23, row.date.slice(0, 7), "axis date-label");
  }

  path(g, rows, x, yLeft, "msciChinaYoy", "series msci");
  path(g, rows, x, yRight, "freeLiquidity", "series liquidity");

  const hoverLine = line(g, 0, margin.top, 0, height - margin.bottom, "hover-line");
  hoverLine.setAttribute("visibility", "hidden");
  const overlay = rect(g, margin.left, margin.top, innerWidth, innerHeight, "overlay");
  overlay.addEventListener("mousemove", (event) => {
    const bounds = chart.getBoundingClientRect();
    const sx = ((event.clientX - bounds.left) / bounds.width) * width;
    const ratio = Math.min(1, Math.max(0, (sx - margin.left) / innerWidth));
    const target = xDomain[0] + ratio * (xDomain[1] - xDomain[0]);
    const row = nearest(rows, target);
    const px = x(new Date(`${row.date}T00:00:00Z`).getTime());
    hoverLine.setAttribute("x1", px);
    hoverLine.setAttribute("x2", px);
    hoverLine.setAttribute("visibility", "visible");
    tooltip.hidden = false;
    tooltip.style.left = `${Math.min(bounds.width - 210, Math.max(8, event.clientX - bounds.left + 12))}px`;
    tooltip.style.top = `${Math.max(8, event.clientY - bounds.top - 72)}px`;
    tooltip.innerHTML = `<strong>${row.date.slice(0, 7)}</strong><br>自由流动性：${formatPct(
      row.freeLiquidity
    )}<br>MSCI YoY：${formatPct(row.msciChinaYoy)}`;
  });
  overlay.addEventListener("mouseleave", () => {
    hoverLine.setAttribute("visibility", "hidden");
    tooltip.hidden = true;
  });
}

function renderTable(rows) {
  rowsBody.innerHTML = rows
    .slice(-12)
    .reverse()
    .map(
      (row) => `<tr>
        <td>${row.date.slice(0, 7)}</td>
        <td class="${classFor(row.m1Yoy)}">${formatPct(row.m1Yoy)}</td>
        <td class="${classFor(row.ppiYoy)}">${formatPct(row.ppiYoy)}</td>
        <td class="${classFor(row.industrialProductionYoy3m)}">${formatPct(row.industrialProductionYoy3m)}</td>
        <td class="${classFor(row.freeLiquidity)}">${formatPct(row.freeLiquidity)}</td>
        <td class="${classFor(row.msciChinaYoy)}">${formatPct(row.msciChinaYoy)}</td>
      </tr>`
    )
    .join("");
}

function path(parent, rows, x, y, key, className) {
  const commands = [];
  let started = false;
  for (const row of rows) {
    const value = row[key];
    if (!isNum(value)) {
      started = false;
      continue;
    }
    const px = x(new Date(`${row.date}T00:00:00Z`).getTime());
    const py = y(value);
    commands.push(`${started ? "L" : "M"}${px.toFixed(2)},${py.toFixed(2)}`);
    started = true;
  }
  const el = document.createElementNS("http://www.w3.org/2000/svg", "path");
  el.setAttribute("d", commands.join(" "));
  el.setAttribute("class", className);
  parent.appendChild(el);
}

function paddedDomain(values, pad) {
  const low = Math.min(...values, 0) - pad;
  const high = Math.max(...values, 0) + pad;
  return low === high ? [low - 1, high + 1] : [low, high];
}

function alignZeroDomains(leftDomain, rightDomain) {
  const ratio = clamp((zeroRatio(leftDomain) + zeroRatio(rightDomain)) / 2, 0.2, 0.8);
  return [domainForZeroRatio(leftDomain, ratio), domainForZeroRatio(rightDomain, ratio)];
}

function zeroRatio([min, max]) {
  return max / Math.max(1e-9, max - min);
}

function domainForZeroRatio([min, max], ratio) {
  const negativeSpan = Math.max(0.0001, Math.abs(Math.min(min, 0)));
  const positiveSpan = Math.max(0.0001, Math.max(max, 0));
  const requiredNegative = positiveSpan * (1 - ratio) / ratio;
  const requiredPositive = negativeSpan * ratio / (1 - ratio);
  return [-Math.max(negativeSpan, requiredNegative), Math.max(positiveSpan, requiredPositive)];
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function ticks([min, max], count) {
  const step = niceStep((max - min) / Math.max(1, count - 1));
  const start = Math.ceil(min / step) * step;
  const result = [];
  for (let value = start; value <= max + step * 0.5; value += step) result.push(Math.round(value * 10) / 10);
  return result;
}

function niceStep(raw) {
  const pow = 10 ** Math.floor(Math.log10(raw || 1));
  const normalized = raw / pow;
  if (normalized <= 1) return pow;
  if (normalized <= 2) return 2 * pow;
  if (normalized <= 5) return 5 * pow;
  return 10 * pow;
}

function pickTicks(rows, count) {
  if (rows.length <= count) return rows;
  const step = (rows.length - 1) / (count - 1);
  return Array.from({ length: count }, (_, index) => rows[Math.round(index * step)]);
}

function nearest(rows, target) {
  return rows.reduce((best, row) => {
    const distance = Math.abs(new Date(`${row.date}T00:00:00Z`).getTime() - target);
    return distance < best.distance ? { row, distance } : best;
  }, { row: rows[0], distance: Infinity }).row;
}

function formatPct(value) {
  return isNum(value) ? `${fmt.format(value)}%` : "--";
}

function classFor(value) {
  if (!isNum(value)) return "";
  if (value > 0) return "positive";
  if (value < 0) return "negative";
  return "neutral";
}

function isNum(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function group(parent, className) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", "g");
  el.setAttribute("class", className);
  parent.appendChild(el);
  return el;
}

function line(parent, x1, y1, x2, y2, className) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", "line");
  el.setAttribute("x1", x1);
  el.setAttribute("y1", y1);
  el.setAttribute("x2", x2);
  el.setAttribute("y2", y2);
  el.setAttribute("class", className);
  parent.appendChild(el);
  return el;
}

function rect(parent, x, y, width, height, className) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  el.setAttribute("x", x);
  el.setAttribute("y", y);
  el.setAttribute("width", width);
  el.setAttribute("height", height);
  el.setAttribute("class", className);
  parent.appendChild(el);
  return el;
}

function text(parent, x, y, content, className) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", "text");
  el.setAttribute("x", x);
  el.setAttribute("y", y);
  el.setAttribute("class", className);
  el.textContent = content;
  parent.appendChild(el);
  return el;
}
