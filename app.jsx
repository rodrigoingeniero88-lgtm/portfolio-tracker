import { useState, useEffect, useCallback } from "react";

const YF_BASE = "https://query1.finance.yahoo.com/v8/finance/chart/";

const PROXIES = [
  (url) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
  (url) => `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`,
  (url) => `https://thingproxy.freeboard.io/fetch/${url}`,
];

async function fetchYahooWithFallback(ticker, interval, range) {
  const url = `${YF_BASE}${ticker}?interval=${interval}&range=${range}`;
  let lastError;
  for (const proxyFn of PROXIES) {
    try {
      const res = await fetch(proxyFn(url), { signal: AbortSignal.timeout(8000) });
      if (!res.ok) continue;
      const raw = await res.text();
      let data;
      try {
        const parsed = JSON.parse(raw);
        data = parsed.contents ? JSON.parse(parsed.contents) : parsed;
      } catch { continue; }
      const result = data?.chart?.result?.[0];
      if (!result) continue;
      const closes = result.indicators.quote[0].close.filter(Boolean);
      if (!closes.length) continue;
      return { closes, lastPrice: closes[closes.length - 1] };
    } catch (e) { lastError = e; }
  }
  throw lastError || new Error("All proxies failed");
}

const INITIAL_POSITIONS = [
  { id: 1, ticker: "VITL", company: "Vital Farms", type: "largo", qty: 83.746, avgPrice: 13.02, currency: "USD", broker: "Fintual", status: "active", tesis: "Ventas +25% anual, sin deuda, castigada por problema contable ya resuelto. PO analistas $48. DCA." },
  { id: 2, ticker: "LTM", company: "LATAM Airlines", type: "largo", qty: 40000, avgPrice: 22.23, currency: "CLP", broker: "Chile", status: "salida", tesis: "Posición en salida. No agregar ni promediar." },
  { id: 3, ticker: "INVERCAP", company: "Invercap", type: "largo", qty: 300, avgPrice: 1928.6, currency: "CLP", broker: "Chile", status: "salida", tesis: "Posición en salida. No agregar ni promediar." },
];

const STOP_LOSS = { swing: 0.08, largo: 0.15 };

function calcRSI(closes, period = 14) {
  if (closes.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) gains += d; else losses -= d;
  }
  let avgGain = gains / period, avgLoss = losses / period;
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + (d > 0 ? d : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (d < 0 ? -d : 0)) / period;
  }
  if (avgLoss === 0) return 100;
  return Math.round((100 - 100 / (1 + avgGain / avgLoss)) * 100) / 100;
}

const fmt = (n, dec = 2) => n == null ? "—" : n.toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec });
const fmtPct = (n) => n == null ? "—" : `${n > 0 ? "+" : ""}${fmt(n)}%`;
const clr = (n) => n == null ? "#8899aa" : n >= 0 ? "#00e5a0" : "#ff4d6d";
const rsiColor = (r) => r == null ? "#8899aa" : r < 35 ? "#00e5a0" : r > 65 ? "#ff4d6d" : "#f0c040";
const rsiLabel = (r) => r == null ? "" : r < 35 ? "SOBREVENDIDO" : r > 65 ? "SOBRECOMPRADO" : "NEUTRAL";

function RSIBar({ value }) {
  if (value == null) return <span style={{ color: "#556" }}>—</span>;
  const pct = Math.min(Math.max(value, 0), 100);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <div style={{ flex: 1, height: 6, background: "#1a2030", borderRadius: 3, position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", left: 0, top: 0, height: "100%", width: `${pct}%`, background: rsiColor(value), borderRadius: 3, transition: "width 0.5s" }} />
        <div style={{ position: "absolute", left: "35%", top: -2, width: 1, height: 10, background: "#334" }} />
        <div style={{ position: "absolute", left: "65%", top: -2, width: 1, height: 10, background: "#334" }} />
      </div>
      <span style={{ color: rsiColor(value), fontWeight: 700, fontSize: 13, minWidth: 36 }}>{fmt(value, 1)}</span>
    </div>
  );
}

export default function PortfolioTracker() {
  const [tab, setTab] = useState("portfolio");
  const [positions, setPositions] = useState(() => {
    try { return JSON.parse(localStorage.getItem("pt_positions")) || INITIAL_POSITIONS; } catch { return INITIAL_POSITIONS; }
  });
  const [watchlist, setWatchlist] = useState(() => {
    try { return JSON.parse(localStorage.getItem("pt_watchlist")) || []; } catch { return []; }
  });
  const [transactions, setTransactions] = useState(() => {
    try { return JSON.parse(localStorage.getItem("pt_transactions")) || []; } catch { return []; }
  });
  const [priceData, setPriceData] = useState({});
  const [loading, setLoading] = useState({});
  const [lastUpdate, setLastUpdate] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [fetchStatus, setFetchStatus] = useState("");

  // Export modal
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportText, setExportText] = useState("");
  const [copyLabel, setCopyLabel] = useState("📋 COPIAR");

  // Import modal
  const [showImportModal, setShowImportModal] = useState(false);
  const [importText, setImportText] = useState("");
  const [importError, setImportError] = useState("");
  const [importSuccess, setImportSuccess] = useState(false);

  // Form modals
  const [showAddPos, setShowAddPos] = useState(false);
  const [showAddWatch, setShowAddWatch] = useState(false);
  const [showAddTx, setShowAddTx] = useState(false);
  const [newPos, setNewPos] = useState({ ticker: "", company: "", type: "largo", qty: "", avgPrice: "", currency: "USD", broker: "IBKR", tesis: "" });
  const [newWatch, setNewWatch] = useState({ ticker: "", type: "observación", tesis: "" });
  const [newTx, setNewTx] = useState({ ticker: "", date: new Date().toISOString().split("T")[0], qty: "", price: "", action: "BUY", currency: "USD" });

  useEffect(() => { localStorage.setItem("pt_positions", JSON.stringify(positions)); }, [positions]);
  useEffect(() => { localStorage.setItem("pt_watchlist", JSON.stringify(watchlist)); }, [watchlist]);
  useEffect(() => { localStorage.setItem("pt_transactions", JSON.stringify(transactions)); }, [transactions]);

  const fetchAll = useCallback(async () => {
    const tickers = [...new Set([
      ...positions.filter(p => p.currency === "USD").map(p => p.ticker),
      ...watchlist.map(w => w.ticker),
    ])];
    if (!tickers.length) return;
    setFetchStatus("Cargando precios...");
    const newAlerts = [];
    const updates = {};
    let loaded = 0;
    await Promise.all(tickers.map(async (ticker) => {
      setLoading(l => ({ ...l, [ticker]: true }));
      try {
        const [daily, weekly] = await Promise.all([
          fetchYahooWithFallback(ticker, "1d", "3mo"),
          fetchYahooWithFallback(ticker, "1wk", "2y"),
        ]);
        const rsiD = calcRSI(daily.closes);
        const rsiW = calcRSI(weekly.closes);
        updates[ticker] = { price: daily.lastPrice, rsiD, rsiW, ts: Date.now() };
        if (rsiD != null && (rsiD < 35 || rsiD > 65))
          newAlerts.push({ ticker, type: "RSI Diario", value: rsiD, label: rsiLabel(rsiD) });
        if (rsiW != null && (rsiW < 35 || rsiW > 65))
          newAlerts.push({ ticker, type: "RSI Semanal", value: rsiW, label: rsiLabel(rsiW) });
      } catch {
        updates[ticker] = { price: null, rsiD: null, rsiW: null, error: true };
      }
      loaded++;
      setFetchStatus(`Cargando... ${loaded}/${tickers.length}`);
      setLoading(l => ({ ...l, [ticker]: false }));
    }));
    positions.forEach(p => {
      if (p.currency !== "USD") return;
      const pd = updates[p.ticker];
      if (!pd?.price) return;
      const pnlPct = (pd.price - p.avgPrice) / p.avgPrice;
      const sl = STOP_LOSS[p.type] || 0.08;
      if (pnlPct <= -sl)
        newAlerts.push({ ticker: p.ticker, type: "STOP LOSS", value: pnlPct * 100, label: `${p.type.toUpperCase()} — SL -${sl * 100}%` });
    });
    setPriceData(prev => ({ ...prev, ...updates }));
    setAlerts(newAlerts);
    setLastUpdate(new Date());
    const errors = Object.values(updates).filter(u => u.error).length;
    setFetchStatus(errors > 0 ? `${errors} sin datos` : "");
  }, [positions, watchlist]);

  useEffect(() => { fetchAll(); }, []);

  const exportJSON = () => {
    const data = { exportedAt: new Date().toISOString(), positions, watchlist, transactions };
    const json = JSON.stringify(data, null, 2);
    setExportText(json);
    setShowExportModal(true);
    navigator.clipboard.writeText(json).catch(() => {});
  };

  const copyExport = () => {
    navigator.clipboard.writeText(exportText).catch(() => {});
    setCopyLabel("✓ COPIADO");
    setTimeout(() => setCopyLabel("📋 COPIAR"), 2000);
  };

  const importJSON = () => {
    setImportError("");
    setImportSuccess(false);
    try {
      const data = JSON.parse(importText);
      if (!data.positions || !Array.isArray(data.positions)) throw new Error("JSON inválido — falta 'positions'");
      if (data.positions) setPositions(data.positions);
      if (data.watchlist) setWatchlist(data.watchlist);
      if (data.transactions) setTransactions(data.transactions);
      setImportSuccess(true);
      setImportText("");
      setTimeout(() => { setShowImportModal(false); setImportSuccess(false); }, 1500);
    } catch (e) {
      setImportError(e.message || "JSON inválido");
    }
  };

  const totalUSD = positions.filter(p => p.currency === "USD").reduce((acc, p) => {
    const pd = priceData[p.ticker];
    return acc + (pd?.price ? pd.price * p.qty : p.avgPrice * p.qty);
  }, 0);
  const costUSD = positions.filter(p => p.currency === "USD").reduce((acc, p) => acc + p.avgPrice * p.qty, 0);
  const totalPnL = totalUSD - costUSD;
  const totalPnLPct = costUSD ? (totalPnL / costUSD) * 100 : 0;

  const addPosition = () => {
    if (!newPos.ticker || !newPos.qty || !newPos.avgPrice) return;
    setPositions(p => [...p, { ...newPos, id: Date.now(), qty: +newPos.qty, avgPrice: +newPos.avgPrice, status: "active" }]);
    setNewPos({ ticker: "", company: "", type: "largo", qty: "", avgPrice: "", currency: "USD", broker: "IBKR", tesis: "" });
    setShowAddPos(false);
  };
  const removePosition = (id) => setPositions(p => p.filter(x => x.id !== id));
  const addWatchlist = () => {
    if (!newWatch.ticker) return;
    setWatchlist(w => [...w, { ...newWatch, id: Date.now(), ticker: newWatch.ticker.toUpperCase() }]);
    setNewWatch({ ticker: "", type: "observación", tesis: "" });
    setShowAddWatch(false);
  };
  const removeWatch = (id) => setWatchlist(w => w.filter(x => x.id !== id));
  const addTransaction = () => {
    if (!newTx.ticker || !newTx.qty || !newTx.price) return;
    setTransactions(t => [{ ...newTx, id: Date.now(), qty: +newTx.qty, price: +newTx.price }, ...t]);
    setNewTx({ ticker: "", date: new Date().toISOString().split("T")[0], qty: "", price: "", action: "BUY", currency: "USD" });
    setShowAddTx(false);
  };

  const s = {
    app: { fontFamily: "'IBM Plex Mono','Courier New',monospace", background: "#080d14", color: "#c8d6e5", minHeight: "100vh", paddingBottom: 60 },
    header: { background: "#0c1220", borderBottom: "1px solid #1e2d40", padding: "16px 20px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10 },
    logo: { fontSize: 16, fontWeight: 700, letterSpacing: 3, color: "#00e5a0" },
    sub: { fontSize: 10, color: "#445", letterSpacing: 2 },
    tabs: { display: "flex", background: "#0c1220", borderBottom: "1px solid #1e2d40", padding: "0 20px" },
    tab: (a) => ({ padding: "11px 16px", cursor: "pointer", fontSize: 10, letterSpacing: 2, fontWeight: 700, color: a ? "#00e5a0" : "#445", borderBottom: a ? "2px solid #00e5a0" : "2px solid transparent", background: "none", border: "none", fontFamily: "inherit" }),
    card: { background: "#0c1624", border: "1px solid #1a2535", borderRadius: 8, padding: 18, marginBottom: 14 },
    label: { fontSize: 10, letterSpacing: 2, color: "#445", marginBottom: 4 },
    val: (c) => ({ fontSize: 20, fontWeight: 700, color: c || "#c8d6e5" }),
    table: { width: "100%", borderCollapse: "collapse", fontSize: 12 },
    th: { textAlign: "left", padding: "8px 10px", color: "#334", fontSize: 10, letterSpacing: 2, borderBottom: "1px solid #1a2535" },
    td: { padding: "10px 10px", borderBottom: "1px solid #111820", verticalAlign: "middle" },
    badge: (c) => ({ display: "inline-block", padding: "2px 7px", borderRadius: 3, fontSize: 10, fontWeight: 700, letterSpacing: 1, background: c + "22", color: c, border: `1px solid ${c}44` }),
    btn: (c = "#00e5a0") => ({ background: c + "18", color: c, border: `1px solid ${c}44`, borderRadius: 4, padding: "6px 12px", cursor: "pointer", fontSize: 11, fontFamily: "inherit", fontWeight: 700, letterSpacing: 1 }),
    input: { background: "#060b10", border: "1px solid #1e2d40", borderRadius: 4, color: "#c8d6e5", padding: "8px 12px", fontSize: 12, fontFamily: "inherit", width: "100%", boxSizing: "border-box" },
    modal: { position: "fixed", inset: 0, background: "#000c", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 },
    mbox: { background: "#0c1624", border: "1px solid #1e2d40", borderRadius: 10, padding: 24, width: 460, maxWidth: "95vw", maxHeight: "90vh", overflowY: "auto" },
    alertRow: (c) => ({ background: c + "18", border: `1px solid ${c}44`, borderRadius: 6, padding: "9px 14px", marginBottom: 7, display: "flex", alignItems: "center", justifyContent: "space-between" }),
  };

  const typeColor = (t) => t === "largo" ? "#5b9cf6" : t === "swing" ? "#f0c040" : "#8899aa";

  return (
    <div style={s.app}>
      <div style={s.header}>
        <div>
          <div style={s.logo}>◈ PORTFOLIO TRACKER</div>
          <div style={s.sub}>IBKR · FINTUAL · CHILE</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ color: clr(totalPnL), fontSize: 18, fontWeight: 700 }}>{totalPnL >= 0 ? "+" : ""}${fmt(totalPnL)}</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end", marginTop: 4 }}>
            <span style={{ fontSize: 10, color: "#334", alignSelf: "center" }}>{fetchStatus || (lastUpdate ? lastUpdate.toLocaleTimeString() : "—")}</span>
            <button onClick={fetchAll} style={{ ...s.btn(), padding: "4px 9px", fontSize: 10 }}>↺ REF</button>
            <button onClick={() => { setShowImportModal(true); setImportText(""); setImportError(""); }} style={{ ...s.btn("#a78bfa"), padding: "4px 9px", fontSize: 10 }}>⬆ IMPORT</button>
            <button onClick={exportJSON} style={{ ...s.btn("#f0c040"), padding: "4px 9px", fontSize: 10 }}>⬇ EXPORT</button>
          </div>
        </div>
      </div>

      {alerts.length > 0 && (
        <div style={{ padding: "10px 20px 0" }}>
          {alerts.map((a, i) => {
            const c = a.type === "STOP LOSS" ? "#ff4d6d" : rsiColor(a.value);
            return (
              <div key={i} style={s.alertRow(c)}>
                <span style={{ color: c, fontWeight: 700, fontSize: 11 }}>⚠ {a.type} — {a.ticker}</span>
                <span style={{ color: "#8899aa", fontSize: 10 }}>{a.label}</span>
              </div>
            );
          })}
        </div>
      )}

      <div style={s.tabs}>
        {["portfolio", "watchlist", "transacciones"].map(t => (
          <button key={t} style={s.tab(tab === t)} onClick={() => setTab(t)}>{t.toUpperCase()}</button>
        ))}
      </div>

      <div style={{ padding: "18px 20px" }}>

        {tab === "portfolio" && (
          <>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginBottom: 14 }}>
              {[
                { label: "VALOR USD", val: `$${fmt(totalUSD)}`, c: "#c8d6e5" },
                { label: "P&L", val: `${totalPnL >= 0 ? "+" : ""}$${fmt(totalPnL)}`, c: clr(totalPnL) },
                { label: "P&L %", val: fmtPct(totalPnLPct), c: clr(totalPnLPct) },
              ].map(item => (
                <div key={item.label} style={s.card}>
                  <div style={s.label}>{item.label}</div>
                  <div style={s.val(item.c)}>{item.val}</div>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <span style={{ fontSize: 10, letterSpacing: 2, color: "#445" }}>POSICIONES</span>
              <button style={s.btn()} onClick={() => setShowAddPos(true)}>+ AGREGAR</button>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={s.table}>
                <thead>
                  <tr>{["TICKER", "TIPO", "QTY", "PROM", "PRECIO", "VALOR", "P&L", "P&L%", "RSI D", "RSI W", ""].map(h => <th key={h} style={s.th}>{h}</th>)}</tr>
                </thead>
                <tbody>
                  {positions.map(pos => {
                    const pd = priceData[pos.ticker];
                    const price = pd?.price;
                    const valor = price ? price * pos.qty : null;
                    const cost = pos.avgPrice * pos.qty;
                    const pnl = valor != null ? valor - cost : null;
                    const pnlPct = pnl != null ? (pnl / cost) * 100 : null;
                    const sl = STOP_LOSS[pos.type] || 0.08;
                    const nearSL = pnlPct != null && pnlPct <= -(sl * 100 * 0.7);
                    return (
                      <tr key={pos.id} style={{ opacity: pos.status === "salida" ? 0.55 : 1, background: nearSL ? "#ff4d6d07" : "transparent" }}>
                        <td style={s.td}>
                          <div style={{ fontWeight: 700, color: "#e0ecf8" }}>{pos.ticker}</div>
                          <div style={{ fontSize: 9, color: "#445" }}>{pos.company}</div>
                          {pos.status === "salida" && <div style={{ fontSize: 9, color: "#ff4d6d" }}>EN SALIDA</div>}
                        </td>
                        <td style={s.td}><span style={s.badge(typeColor(pos.type))}>{pos.type.toUpperCase()}</span></td>
                        <td style={s.td}>{fmt(pos.qty, pos.qty % 1 === 0 ? 0 : 3)}</td>
                        <td style={s.td}>{fmt(pos.avgPrice)} <span style={{ fontSize: 9, color: "#445" }}>{pos.currency}</span></td>
                        <td style={s.td}>{loading[pos.ticker] ? <span style={{ color: "#334" }}>…</span> : price ? `$${fmt(price)}` : pd?.error ? <span style={{ fontSize: 9, color: "#ff4d6d" }}>ERR</span> : <span style={{ color: "#334" }}>—</span>}</td>
                        <td style={s.td}>{valor ? `$${fmt(valor)}` : "—"}</td>
                        <td style={s.td}><span style={{ color: clr(pnl) }}>{pnl != null ? `${pnl >= 0 ? "+" : ""}$${fmt(pnl)}` : "—"}</span></td>
                        <td style={s.td}><span style={{ color: clr(pnlPct) }}>{fmtPct(pnlPct)}</span></td>
                        <td style={s.td}><RSIBar value={pd?.rsiD} /></td>
                        <td style={s.td}><RSIBar value={pd?.rsiW} /></td>
                        <td style={s.td}><button style={{ ...s.btn("#ff4d6d"), padding: "2px 7px" }} onClick={() => removePosition(pos.id)}>✕</button></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}

        {tab === "watchlist" && (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <span style={{ fontSize: 10, letterSpacing: 2, color: "#445" }}>WATCHLIST</span>
              <button style={s.btn()} onClick={() => setShowAddWatch(true)}>+ AGREGAR</button>
            </div>
            {watchlist.length === 0 && <div style={{ color: "#334", padding: 24, textAlign: "center", fontSize: 12 }}>Watchlist vacío.</div>}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(260px,1fr))", gap: 12 }}>
              {watchlist.map(w => {
                const pd = priceData[w.ticker];
                return (
                  <div key={w.id} style={{ ...s.card, position: "relative" }}>
                    <button style={{ position: "absolute", top: 10, right: 10, ...s.btn("#ff4d6d"), padding: "2px 7px" }} onClick={() => removeWatch(w.id)}>✕</button>
                    <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 6 }}>
                      <span style={{ fontWeight: 700, fontSize: 15, color: "#e0ecf8" }}>{w.ticker}</span>
                      <span style={s.badge(typeColor(w.type))}>{w.type.toUpperCase()}</span>
                    </div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: "#c8d6e5", marginBottom: 8 }}>
                      {loading[w.ticker] ? <span style={{ color: "#334", fontSize: 12 }}>cargando…</span> : pd?.error ? <span style={{ color: "#ff4d6d", fontSize: 11 }}>sin datos</span> : pd?.price ? `$${fmt(pd.price)}` : "—"}
                    </div>
                    <div style={{ marginBottom: 6 }}>
                      <div style={{ fontSize: 9, color: "#445", marginBottom: 2 }}>RSI DIARIO</div>
                      <RSIBar value={pd?.rsiD} />
                      {pd?.rsiD != null && (pd.rsiD < 35 || pd.rsiD > 65) && <div style={{ fontSize: 9, color: rsiColor(pd.rsiD), marginTop: 2 }}>{rsiLabel(pd.rsiD)}</div>}
                    </div>
                    <div style={{ marginBottom: 10 }}>
                      <div style={{ fontSize: 9, color: "#445", marginBottom: 2 }}>RSI SEMANAL</div>
                      <RSIBar value={pd?.rsiW} />
                    </div>
                    {w.tesis && <div style={{ fontSize: 10, color: "#556", borderTop: "1px solid #1a2535", paddingTop: 8 }}>{w.tesis}</div>}
                  </div>
                );
              })}
            </div>
          </>
        )}

        {tab === "transacciones" && (
          <>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <span style={{ fontSize: 10, letterSpacing: 2, color: "#445" }}>TRANSACCIONES</span>
              <button style={s.btn()} onClick={() => setShowAddTx(true)}>+ REGISTRAR</button>
            </div>
            {transactions.length === 0 && <div style={{ color: "#334", padding: 24, textAlign: "center", fontSize: 12 }}>Sin transacciones.</div>}
            <table style={s.table}>
              <thead>
                <tr>{["FECHA", "ACCIÓN", "TICKER", "QTY", "PRECIO", "TOTAL", "USD/CLP"].map(h => <th key={h} style={s.th}>{h}</th>)}</tr>
              </thead>
              <tbody>
                {transactions.map(tx => (
                  <tr key={tx.id}>
                    <td style={s.td}>{tx.date}</td>
                    <td style={s.td}><span style={s.badge(tx.action === "BUY" ? "#00e5a0" : "#ff4d6d")}>{tx.action}</span></td>
                    <td style={{ ...s.td, fontWeight: 700, color: "#e0ecf8" }}>{tx.ticker}</td>
                    <td style={s.td}>{fmt(tx.qty, 3)}</td>
                    <td style={s.td}>${fmt(tx.price)}</td>
                    <td style={s.td}>${fmt(tx.qty * tx.price)}</td>
                    <td style={s.td}><span style={{ color: "#445", fontSize: 10 }}>{tx.currency}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </div>

      {/* ══ IMPORT MODAL ══ */}
      {showImportModal && (
        <div style={s.modal} onClick={() => setShowImportModal(false)}>
          <div style={{ ...s.mbox, width: 500 }} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <span style={{ fontWeight: 700, letterSpacing: 2, color: "#a78bfa", fontSize: 12 }}>⬆ IMPORTAR JSON</span>
              <button style={{ ...s.btn("#445"), padding: "4px 10px" }} onClick={() => setShowImportModal(false)}>✕</button>
            </div>
            <div style={{ fontSize: 11, color: "#556", marginBottom: 10, lineHeight: 1.6 }}>
              Pegá el JSON que te dio Claude en el chat. Esto reemplaza todos los datos actuales.
            </div>
            <textarea
              value={importText}
              onChange={e => { setImportText(e.target.value); setImportError(""); }}
              placeholder='{ "positions": [...], "watchlist": [...], "transactions": [...] }'
              style={{ width: "100%", height: 240, background: "#060b10", border: `1px solid ${importError ? "#ff4d6d" : "#1e2d40"}`, borderRadius: 6, color: "#c8d6e5", fontSize: 10, fontFamily: "'IBM Plex Mono',monospace", padding: 12, boxSizing: "border-box", resize: "none", lineHeight: 1.6 }}
            />
            {importError && <div style={{ color: "#ff4d6d", fontSize: 11, marginTop: 6 }}>⚠ {importError}</div>}
            {importSuccess && <div style={{ color: "#00e5a0", fontSize: 11, marginTop: 6 }}>✓ Datos importados correctamente</div>}
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button style={{ ...s.btn("#a78bfa"), flex: 1, padding: "9px" }} onClick={importJSON}>IMPORTAR</button>
              <button style={{ ...s.btn("#445"), flex: 1, padding: "9px" }} onClick={() => setShowImportModal(false)}>CANCELAR</button>
            </div>
          </div>
        </div>
      )}

      {/* ══ EXPORT MODAL ══ */}
      {showExportModal && (
        <div style={s.modal} onClick={() => setShowExportModal(false)}>
          <div style={{ ...s.mbox, width: 500 }} onClick={e => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <span style={{ fontWeight: 700, letterSpacing: 2, color: "#f0c040", fontSize: 12 }}>⬇ EXPORT JSON</span>
              <button style={{ ...s.btn("#445"), padding: "4px 10px" }} onClick={() => setShowExportModal(false)}>✕</button>
            </div>
            <div style={{ fontSize: 11, color: "#556", marginBottom: 10, lineHeight: 1.6 }}>
              Tocá el cuadro → <strong style={{ color: "#8899aa" }}>Seleccionar todo</strong> → Copiar. O usá el botón.
            </div>
            <textarea
              readOnly value={exportText}
              onFocus={e => e.target.select()} onClick={e => e.target.select()}
              style={{ width: "100%", height: 260, background: "#060b10", border: "1px solid #1e2d40", borderRadius: 6, color: "#6a9ab8", fontSize: 10, fontFamily: "'IBM Plex Mono',monospace", padding: 12, boxSizing: "border-box", resize: "none", lineHeight: 1.6 }}
            />
            <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
              <button style={{ ...s.btn("#f0c040"), flex: 1, padding: "9px" }} onClick={copyExport}>{copyLabel}</button>
              <button style={{ ...s.btn("#445"), flex: 1, padding: "9px" }} onClick={() => setShowExportModal(false)}>CERRAR</button>
            </div>
          </div>
        </div>
      )}

      {/* ══ ADD POSITION ══ */}
      {showAddPos && (
        <div style={s.modal} onClick={() => setShowAddPos(false)}>
          <div style={s.mbox} onClick={e => e.stopPropagation()}>
            <div style={{ fontWeight: 700, marginBottom: 14, letterSpacing: 2, color: "#00e5a0" }}>+ NUEVA POSICIÓN</div>
            {[
              { label: "TICKER", key: "ticker", ph: "AAPL" },
              { label: "EMPRESA", key: "company", ph: "Apple Inc." },
              { label: "CANTIDAD", key: "qty", ph: "100", type: "number" },
              { label: "PRECIO PROMEDIO", key: "avgPrice", ph: "150.00", type: "number" },
              { label: "BROKER", key: "broker", ph: "IBKR" },
              { label: "TESIS", key: "tesis", ph: "Razón de la posición..." },
            ].map(f => (
              <div key={f.key} style={{ marginBottom: 9 }}>
                <div style={s.label}>{f.label}</div>
                <input style={s.input} value={newPos[f.key]} type={f.type || "text"} placeholder={f.ph}
                  onChange={e => setNewPos(p => ({ ...p, [f.key]: e.target.value }))} />
              </div>
            ))}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 9, marginBottom: 14 }}>
              <div>
                <div style={s.label}>TIPO</div>
                <select style={s.input} value={newPos.type} onChange={e => setNewPos(p => ({ ...p, type: e.target.value }))}>
                  <option value="largo">Largo plazo</option>
                  <option value="swing">Swing</option>
                  <option value="observación">Observación</option>
                </select>
              </div>
              <div>
                <div style={s.label}>MONEDA</div>
                <select style={s.input} value={newPos.currency} onChange={e => setNewPos(p => ({ ...p, currency: e.target.value }))}>
                  <option value="USD">USD</option>
                  <option value="CLP">CLP</option>
                </select>
              </div>
            </div>
            <div style={{ display: "flex", gap: 9 }}>
              <button style={{ ...s.btn(), flex: 1, padding: "10px" }} onClick={addPosition}>AGREGAR</button>
              <button style={{ ...s.btn("#445"), flex: 1, padding: "10px" }} onClick={() => setShowAddPos(false)}>CANCELAR</button>
            </div>
          </div>
        </div>
      )}

      {/* ══ ADD WATCHLIST ══ */}
      {showAddWatch && (
        <div style={s.modal} onClick={() => setShowAddWatch(false)}>
          <div style={s.mbox} onClick={e => e.stopPropagation()}>
            <div style={{ fontWeight: 700, marginBottom: 14, letterSpacing: 2, color: "#00e5a0" }}>+ WATCHLIST</div>
            <div style={{ marginBottom: 9 }}>
              <div style={s.label}>TICKER</div>
              <input style={s.input} value={newWatch.ticker} placeholder="MSFT" onChange={e => setNewWatch(p => ({ ...p, ticker: e.target.value.toUpperCase() }))} />
            </div>
            <div style={{ marginBottom: 9 }}>
              <div style={s.label}>TIPO</div>
              <select style={s.input} value={newWatch.type} onChange={e => setNewWatch(p => ({ ...p, type: e.target.value }))}>
                <option value="observación">Observación</option>
                <option value="swing">Swing</option>
                <option value="largo">Largo plazo</option>
              </select>
            </div>
            <div style={{ marginBottom: 14 }}>
              <div style={s.label}>TESIS</div>
              <input style={s.input} value={newWatch.tesis} placeholder="Razón..." onChange={e => setNewWatch(p => ({ ...p, tesis: e.target.value }))} />
            </div>
            <div style={{ display: "flex", gap: 9 }}>
              <button style={{ ...s.btn(), flex: 1, padding: "10px" }} onClick={addWatchlist}>AGREGAR</button>
              <button style={{ ...s.btn("#445"), flex: 1, padding: "10px" }} onClick={() => setShowAddWatch(false)}>CANCELAR</button>
            </div>
          </div>
        </div>
      )}

      {/* ══ ADD TRANSACTION ══ */}
      {showAddTx && (
        <div style={s.modal} onClick={() => setShowAddTx(false)}>
          <div style={s.mbox} onClick={e => e.stopPropagation()}>
            <div style={{ fontWeight: 700, marginBottom: 14, letterSpacing: 2, color: "#00e5a0" }}>+ TRANSACCIÓN</div>
            {[
              { label: "TICKER", key: "ticker", ph: "AAPL" },
              { label: "FECHA", key: "date", type: "date" },
              { label: "CANTIDAD", key: "qty", ph: "100", type: "number" },
              { label: "PRECIO", key: "price", ph: "150.00", type: "number" },
            ].map(f => (
              <div key={f.key} style={{ marginBottom: 9 }}>
                <div style={s.label}>{f.label}</div>
                <input style={s.input} value={newTx[f.key]} type={f.type || "text"} placeholder={f.ph}
                  onChange={e => setNewTx(p => ({ ...p, [f.key]: e.target.value }))} />
              </div>
            ))}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 9, marginBottom: 14 }}>
              <div>
                <div style={s.label}>ACCIÓN</div>
                <select style={s.input} value={newTx.action} onChange={e => setNewTx(p => ({ ...p, action: e.target.value }))}>
                  <option value="BUY">BUY</option>
                  <option value="SELL">SELL</option>
                </select>
              </div>
              <div>
                <div style={s.label}>MONEDA</div>
                <select style={s.input} value={newTx.currency} onChange={e => setNewTx(p => ({ ...p, currency: e.target.value }))}>
                  <option value="USD">USD</option>
                  <option value="CLP">CLP</option>
                </select>
              </div>
            </div>
            <div style={{ display: "flex", gap: 9 }}>
              <button style={{ ...s.btn(), flex: 1, padding: "10px" }} onClick={addTransaction}>REGISTRAR</button>
              <button style={{ ...s.btn("#445"), flex: 1, padding: "10px" }} onClick={() => setShowAddTx(false)}>CANCELAR</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
