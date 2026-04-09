export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const { ticker } = req.query;
  if (!ticker) return res.status(400).json({ error: "ticker required" });
  try {
    const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${ticker}?modules=price,summaryProfile,defaultKeyStatistics,financialData`;
    const response = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" }
    });
    const data = await response.json();
    const result = data?.quoteSummary?.result?.[0];
    if (!result) return res.status(404).json({ error: "No data" });
    const price = result.price || {};
    const profile = result.summaryProfile || {};
    const stats = result.defaultKeyStatistics || {};
    const fin = result.financialData || {};

    const marketCap = price.marketCap?.raw || null;
    const freeCashflow = fin.freeCashflow?.raw || null;
    const ebitda = fin.ebitda?.raw || null;
    const totalDebt = fin.totalDebt?.raw || null;
    const cash = fin.totalCash?.raw || null;
    const ev = marketCap && totalDebt && cash ? marketCap + totalDebt - cash : null;

    res.status(200).json({
      name: price.longName || price.shortName || ticker,
      sector: profile.sector || null,
      industry: profile.industry || null,
      pe: price.trailingPE?.raw || null,
      pfcf: marketCap && freeCashflow && freeCashflow > 0 ? marketCap / freeCashflow : null,
      evEbitda: ev && ebitda && ebitda > 0 ? ev / ebitda : null,
      marketCap,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
