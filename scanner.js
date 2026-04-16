const BASE = 'https://api.bybit.com';
const CONCURRENCY = 5;
const DELAY = 150;

const TF         = process.env.TIMEFRAME    || '60';
const LBL        = parseInt(process.env.LB_LEFT)     || 5;
const LBR        = parseInt(process.env.LB_RIGHT)    || 5;
const RNG_LO     = parseInt(process.env.RANGE_LOWER) || 5;
const RNG_HI     = parseInt(process.env.RANGE_UPPER) || 60;
const MIN_RSI    = parseFloat(process.env.MIN_RSI_DROP) || 2;
const MAX_BARS   = parseInt(process.env.MAX_BARS_AGO) || 2;
const MIN_STR    = parseFloat(process.env.MIN_STRENGTH) || 8;
const NTFY_TOPIC = process.env.NTFY_TOPIC || '';
const LIMIT      = 150;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function calcRSI(closes, p = 14) {
  if (closes.length < p + 2) return [];
  const out = new Array(closes.length).fill(null);
  let ag = 0, al = 0;
  for (let i = 1; i <= p; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) ag += d; else al -= d;
  }
  ag /= p; al /= p;
  out[p] = 100 - 100 / (1 + ag / (al || 1e-10));
  for (let i = p + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    ag = (ag * (p - 1) + (d > 0 ? d : 0)) / p;
    al = (al * (p - 1) + (d < 0 ? -d : 0)) / p;
    out[i] = 100 - 100 / (1 + ag / (al || 1e-10));
  }
  return out;
}

function findRSIPivotHighs(rsi, lbL, lbR) {
  const out = [];
  for (let i = lbL; i < rsi.length - lbR; i++) {
    if (rsi[i] === null) continue;
    let ok = true;
    for (let j = i - lbL; j <= i + lbR; j++) {
      if (j !== i && rsi[j] !== null && rsi[j] >= rsi[i]) { ok = false; break; }
    }
    if (ok) out.push(i);
  }
  return out;
}

function detectDiv(closes, highs, times) {
  if (closes.length < 40) return null;
  const rsi = calcRSI(closes, 14);
  const pivots = findRSIPivotHighs(rsi, LBL, LBR);
  if (pivots.length < 2) return null;

  for (let b = pivots.length - 1; b >= 1; b--) {
    const i2 = pivots[b];
    const barsAgo = closes.length - 1 - i2;
    if (barsAgo > MAX_BARS) continue;

    const i1 = pivots[b - 1];
    const gap = i2 - i1;
    if (gap < RNG_LO || gap > RNG_HI) continue;

    const r1 = rsi[i1], r2 = rsi[i2];
    const pH1 = highs[i1], pH2 = highs[i2];
    if (!r1 || !r2) continue;

    if (r2 < r1 - MIN_RSI && pH2 > pH1 * 1.003) {
      return {
        rsiDiff: r1 - r2,
        priceDiff: ((pH2 - pH1) / pH1) * 100,
        rsiH1: r1, rsiH2: r2,
        priceH1: pH1, priceH2: pH2,
        barsAgo,
        timeSH1: times[i1],
        timeSH2: times[i2]
      };
    }
  }
  return null;
}

async function fetchSymbols() {
  const r = await fetch(`${BASE}/v5/market/instruments-info?category=linear&limit=1000&status=Trading`);
  const d = await r.json();
  return d.result.list
    .filter(s => s.symbol.endsWith('USDT') && s.contractType === 'LinearPerpetual')
    .map(s => s.symbol);
}

async function fetchKlines(sym) {
  try {
    const r = await fetch(`${BASE}/v5/market/kline?category=linear&symbol=${sym}&interval=${TF}&limit=${LIMIT}`);
    const d = await r.json();
    if (d.retCode !== 0) return null;
    return d.result.list.reverse().map(k => ({
      close: parseFloat(k[4]),
      high:  parseFloat(k[2]),
      time:  parseInt(k[0])
    }));
  } catch { return null; }
}

function fmtTime(ts) {
  if (!ts) return '?';
  const d = new Date(ts + 5.5 * 3600000);
  const pad = n => ('0'+n).slice(-2);
  return `${pad(d.getUTCMonth()+1)}/${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} LKT`;
}

async function sendNtfy(signal, sym) {
  if (!NTFY_TOPIC) return;
  const base = sym.replace('USDT', '');
  const tfLabel = TF === 'D' ? '1D' : TF === '60' ? '1H' : TF === '240' ? '4H' : TF + 'm';
  const title = `Bear Div: ${base}/USDT (${tfLabel})`;
  const body = [
    `RSI drop: -${signal.rsiDiff.toFixed(1)} (${signal.rsiH1.toFixed(1)} → ${signal.rsiH2.toFixed(1)})`,
    `Price rise: +${signal.priceDiff.toFixed(2)}%`,
    `SH1: ${fmtTime(signal.timeSH1)}`,
    `SH2: ${fmtTime(signal.timeSH2)}`,
    `Bars ago: ${signal.barsAgo}`,
    `https://www.tradingview.com/chart/?symbol=BYBIT:${sym}.P`
  ].join('\n');

  const priority = signal.rsiDiff >= 12 ? 'urgent' : signal.rsiDiff >= 8 ? 'high' : 'default';

  try {
    const res = await fetch(`https://ntfy.sh/${encodeURIComponent(NTFY_TOPIC)}`, {
      method: 'POST',
      headers: {
        'Title': title,
        'Priority': priority,
        'Tags': 'chart_with_downwards_trend,rotating_light'
      },
      body
    });
    if (res.ok) console.log(`  Notified: ${sym} (RSI drop -${signal.rsiDiff.toFixed(1)})`);
    else console.log(`  ntfy failed: ${res.status}`);
  } catch (e) {
    console.error(`  ntfy error: ${e.message}`);
  }
}

async function main() {
  const started = new Date().toISOString();
  console.log(`\n=== Bearish Divergence Scanner ===`);
  console.log(`Time: ${started}`);
  console.log(`TF: ${TF}m | LbL: ${LBL} | LbR: ${LBR} | Range: ${RNG_LO}-${RNG_HI} | MinRSI: ${MIN_RSI} | MaxBarsAgo: ${MAX_BARS} | MinStrength: ${MIN_STR}`);

  let symbols;
  try {
    symbols = await fetchSymbols();
    console.log(`Scanning ${symbols.length} USDT perpetuals...\n`);
  } catch (e) {
    console.error('Failed to fetch symbols:', e.message);
    process.exit(1);
  }

  const signals = [];
  for (let i = 0; i < symbols.length; i += CONCURRENCY) {
    const chunk = symbols.slice(i, i + CONCURRENCY);
    const results = await Promise.all(chunk.map(async sym => {
      try {
        const klines = await fetchKlines(sym);
        if (!klines || klines.length < 40) return null;
        const div = detectDiv(
          klines.map(k => k.close),
          klines.map(k => k.high),
          klines.map(k => k.time)
        );
        if (div) return { symbol: sym, ...div };
      } catch {}
      return null;
    }));
    results.filter(Boolean).forEach(s => signals.push(s));
    await sleep(DELAY);
  }

  console.log(`Found ${signals.length} divergences. Strong (>= ${MIN_STR}): ${signals.filter(s => s.rsiDiff >= MIN_STR).length}\n`);

  const strong = signals.filter(s => s.rsiDiff >= MIN_STR);
  if (strong.length === 0) {
    console.log('No strong signals this scan.');
  } else {
    for (const s of strong) {
      console.log(`${s.symbol} | RSI drop: -${s.rsiDiff.toFixed(1)} | Price: +${s.priceDiff.toFixed(2)}% | SH2: ${fmtTime(s.timeSH2)}`);
      await sendNtfy(s, s.symbol);
    }
  }

  console.log('\nDone.');
}

main().catch(e => { console.error(e); process.exit(1); });
