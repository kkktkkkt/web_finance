// ──────────────────────────────────────────
//  定数・色パレット
// ──────────────────────────────────────────
// APP_USERNAME は index.html の <script> タグでサーバーから注入される
// ユーザーごとに別々の localStorage キーにすることで、
// 同じブラウザを複数人で使っても銘柄リストが混ざらない
const STORAGE_KEY = "ytd_symbols_" + (window.APP_USERNAME || "guest");

const COLORS = [
  "#5b8dee", "#ee5b8d", "#5beeb0", "#eec85b",
  "#b05bee", "#ee8d5b", "#5beeee", "#ee5b5b",
  "#8dee5b", "#5b5bee",
];

// ──────────────────────────────────────────
//  状態
// ──────────────────────────────────────────
let symbols = loadSymbols();          // ["AAPL", "7203.T", ...]
let chartInstance = null;
const cache = {};                      // symbol → { dates, closes }

// ──────────────────────────────────────────
//  localStorage
// ──────────────────────────────────────────
function loadSymbols() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
  } catch {
    return [];
  }
}

function saveSymbols() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(symbols));
}

// ──────────────────────────────────────────
//  API
// ──────────────────────────────────────────
async function fetchStock(symbol) {
  if (cache[symbol]) return cache[symbol];

  const res = await fetch(`/api/stock?symbol=${encodeURIComponent(symbol)}`);
  const data = await res.json();

  if (!res.ok) throw new Error(data.error || "Unknown error");
  cache[symbol] = data;
  return data;
}

// ──────────────────────────────────────────
//  グラフ
// ──────────────────────────────────────────
function colorFor(index) {
  return COLORS[index % COLORS.length];
}

async function renderChart() {
  const ctx = document.getElementById("stockChart").getContext("2d");
  showLoading(true);
  hideError();

  // 全銘柄のデータを並列取得
  const results = await Promise.allSettled(
    symbols.map((s) => fetchStock(s))
  );

  // エラーがあれば表示
  const errors = results
    .map((r, i) => (r.status === "rejected" ? `${symbols[i]}: ${r.reason.message}` : null))
    .filter(Boolean);

  if (errors.length) showError(errors.join(" / "));

  // 成功データのみ抽出
  const datasets = results
    .map((r, i) => ({ result: r, symbol: symbols[i], colorIndex: i }))
    .filter(({ result }) => result.status === "fulfilled")
    .map(({ result, symbol, colorIndex }) => {
      const { dates, closes } = result.value;
      const color = colorFor(colorIndex);
      return {
        label: symbol,
        data: dates.map((d, j) => ({ x: d, y: closes[j] })),
        borderColor: color,
        backgroundColor: color + "22",
        borderWidth: 2,
        pointRadius: 0,
        pointHoverRadius: 4,
        tension: 0.1,
      };
    });

  if (chartInstance) {
    chartInstance.destroy();
  }

  chartInstance = new Chart(ctx, {
    type: "line",
    data: { datasets },
    options: {
      responsive: true,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: {
          labels: { color: "#c0c0d0", font: { size: 13 } },
        },
        tooltip: {
          callbacks: {
            label: (ctx) => ` ${ctx.dataset.label}: ${ctx.parsed.y.toFixed(2)}`,
          },
        },
      },
      scales: {
        x: {
          type: "category",
          ticks: {
            color: "#7a7f99",
            maxTicksLimit: 10,
            maxRotation: 0,
          },
          grid: { color: "#2a2f45" },
        },
        y: {
          ticks: { color: "#7a7f99" },
          grid: { color: "#2a2f45" },
        },
      },
    },
  });

  showLoading(false);
}

// ──────────────────────────────────────────
//  銘柄リスト UI
// ──────────────────────────────────────────
function renderSymbolList() {
  const list = document.getElementById("symbolList");
  list.innerHTML = "";

  symbols.forEach((symbol, i) => {
    const tag = document.createElement("div");
    tag.className = "symbol-tag";
    tag.style.setProperty("--tag-color", colorFor(i));

    const label = document.createElement("span");
    label.textContent = symbol;

    const btn = document.createElement("button");
    btn.className = "delete-btn";
    btn.title = "削除";
    btn.textContent = "×";
    btn.addEventListener("click", () => removeSymbol(symbol));

    tag.appendChild(label);
    tag.appendChild(btn);
    list.appendChild(tag);
  });
}

// ──────────────────────────────────────────
//  銘柄の追加・削除
// ──────────────────────────────────────────
function addSymbol(raw) {
  const symbol = raw.trim().toUpperCase();
  if (!symbol) return;
  if (symbols.includes(symbol)) {
    showError(`${symbol} はすでに追加されています`);
    return;
  }
  symbols.push(symbol);
  saveSymbols();
  renderSymbolList();
  renderChart();
}

function removeSymbol(symbol) {
  symbols = symbols.filter((s) => s !== symbol);
  delete cache[symbol];
  saveSymbols();
  renderSymbolList();
  if (symbols.length > 0) {
    renderChart();
  } else {
    if (chartInstance) {
      chartInstance.destroy();
      chartInstance = null;
    }
  }
}

// ──────────────────────────────────────────
//  UI ヘルパー
// ──────────────────────────────────────────
function showLoading(flag) {
  document.getElementById("loadingMsg").classList.toggle("hidden", !flag);
}

function showError(msg) {
  const el = document.getElementById("errorMsg");
  el.textContent = msg;
  el.classList.remove("hidden");
  setTimeout(() => el.classList.add("hidden"), 5000);
}

function hideError() {
  document.getElementById("errorMsg").classList.add("hidden");
}

// ──────────────────────────────────────────
//  オートコンプリート
// ──────────────────────────────────────────
const acInput    = document.getElementById("symbolInput");
const acDropdown = document.getElementById("acDropdown");
let acItems  = [];
let acIndex  = -1;
let acTimer  = null;

async function fetchSuggestions(q) {
  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
    return res.ok ? await res.json() : [];
  } catch {
    return [];
  }
}

function renderDropdown(items) {
  acItems = items;
  acIndex = -1;
  acDropdown.innerHTML = "";

  if (items.length === 0) { closeDropdown(); return; }

  items.forEach((item, i) => {
    const el = document.createElement("div");
    el.className = "autocomplete-item";

    const sym  = document.createElement("span");
    sym.className = "ac-symbol";
    sym.textContent = item.symbol;

    const name = document.createElement("span");
    name.className = "ac-name";
    name.textContent = item.name;

    const exch = document.createElement("span");
    exch.className = "ac-exchange";
    exch.textContent = item.exchange;

    el.append(sym, name, exch);
    el.addEventListener("mousedown", (e) => {
      e.preventDefault();   // blur より先に発火させる
      selectAcItem(i);
    });
    acDropdown.appendChild(el);
  });

  acDropdown.classList.remove("hidden");
}

function closeDropdown() {
  acDropdown.classList.add("hidden");
  acIndex = -1;
}

function selectAcItem(index) {
  const item = acItems[index];
  if (!item) return;
  acInput.value = item.symbol;
  closeDropdown();
}

function highlightAcItem(newIndex) {
  const els = acDropdown.querySelectorAll(".autocomplete-item");
  els.forEach((el) => el.classList.remove("active"));
  if (newIndex >= 0 && newIndex < els.length) {
    acIndex = newIndex;
    els[acIndex].classList.add("active");
    acInput.value = acItems[acIndex].symbol;
  } else {
    acIndex = -1;
  }
}

// ──────────────────────────────────────────
//  イベント
// ──────────────────────────────────────────
acInput.addEventListener("input", () => {
  clearTimeout(acTimer);
  const q = acInput.value.trim();
  if (q.length < 1) { closeDropdown(); return; }
  acTimer = setTimeout(async () => {
    const items = await fetchSuggestions(q);
    renderDropdown(items);
  }, 300);
});

acInput.addEventListener("keydown", (e) => {
  const open = !acDropdown.classList.contains("hidden");
  const count = acItems.length;

  if (e.key === "ArrowDown") {
    if (!open) return;
    e.preventDefault();
    highlightAcItem(acIndex < count - 1 ? acIndex + 1 : 0);
  } else if (e.key === "ArrowUp") {
    if (!open) return;
    e.preventDefault();
    highlightAcItem(acIndex > 0 ? acIndex - 1 : count - 1);
  } else if (e.key === "Enter") {
    if (open && acIndex >= 0) {
      e.preventDefault();
      selectAcItem(acIndex);
    }
    closeDropdown();
    document.getElementById("addBtn").click();
  } else if (e.key === "Escape") {
    closeDropdown();
  }
});

acInput.addEventListener("blur", () => {
  // mousedown の selectAcItem が先に完了してから閉じる
  setTimeout(closeDropdown, 150);
});

document.getElementById("addBtn").addEventListener("click", () => {
  closeDropdown();
  addSymbol(acInput.value);
  acInput.value = "";
  acInput.focus();
});

// ──────────────────────────────────────────
//  初期表示
// ──────────────────────────────────────────
renderSymbolList();
if (symbols.length > 0) renderChart();
