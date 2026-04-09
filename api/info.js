export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const { ticker } = req.query;
  if (!ticker) return res.status(400).json({ error: "ticker required" });
  try {
    const url = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${ticker}?modules=price,summaryProfile,financialData,defaultKeyStatistics`;
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "application/json",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": "https://finance.yahoo.com",
        "Origin": "https://finance.yahoo.com",
      }
    });
    const data = await response.json();
    const result = data?.quoteSummary?.result?.[0];
    if (!result) return res.status(404).json({ error: "No data" });
    const price = result.price || {};
    const profile = result.summaryProfile || {};
    const fin = result.financialData || {};
    const marketCap = price.marketCap?.raw || null;
    const freeCashflow = fin.freeCashflow?.raw || null;
    const ebitda = fin.ebitda?.raw || null;
    const totalDebt = fin.totalDebt?.raw || null;
    const cash = fin.totalCash?.raw || null;
    const ev = marketCap && totalDebt != null && cash != null ? marketCap + totalDebt - cash : null;
    res.status(200).json({
      name: price.longName || price.shortName || ticker,
      sector: profile.sector || null,
      industry: profile.industry || null,
      pfcf: marketCap && freeCashflow && freeCashflow > 0 ? marketCap / freeCashflow : null,
      evEbitda: ev && ebitda && ebitda > 0 ? ev / ebitda : null,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
