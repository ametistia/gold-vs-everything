import React, { useState, useEffect, useMemo } from 'react';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceDot
} from 'recharts';
import historicalData from './data/historical.json';

// =====================================================================
// DATA ADAPTER
// ---------------------------------------------------------------------
// Your compile_historical_data.py produces JSON with this shape:
//
//   { gold_prices: { "1971": 40.80, ... },
//     assets: {
//       big_mac: { label, emoji, framing, prices: { "1971": 0.65, ... }},
//       ...
//     }
//   }
//
// But my component works with a slightly enriched schema (added `short`,
// `unit`, `live`, `liveSymbol`, `lastUpdated`, `special`). So we merge.
// This way you can re-run your Python script and just re-drop the JSON.
// =====================================================================

const ASSET_ENRICHMENT = {
  sp500:           { short: 'S&P 500',  unit: 'index units',  live: true,  liveSymbol: 'sp500',  displayOrder: 1 },
  median_home:     { short: 'a house',  unit: 'houses',       live: false, lastUpdated: 'Q4 2025 (FRED)', displayOrder: 2 },
  oil:             { short: 'oil',      unit: 'barrels',      live: true,  liveSymbol: 'oil',    displayOrder: 3 },
  silver:          { short: 'silver',   unit: 'oz of silver', live: true,  liveSymbol: 'silver', displayOrder: 4 },
  gasoline:        { short: 'gas',      unit: 'gallons',      live: false, lastUpdated: 'weekly EIA', displayOrder: 5 },
  new_car:         { short: 'a car',    unit: 'cars',         live: false, lastUpdated: 'annual KBB', displayOrder: 6 },
  big_mac:         { short: 'Big Macs', unit: 'Big Macs',     live: false, lastUpdated: 'annual', displayOrder: 7 },
  harvard_tuition: { short: 'Harvard',  unit: 'years of tuition', live: false, lastUpdated: 'annual', displayOrder: 8 },
  hours_of_work:   { short: 'labor',    unit: 'hours',        live: false, lastUpdated: 'monthly BLS', special: 'hours', displayOrder: 9 },
  bitcoin:         { short: 'BTC',      unit: 'BTC',          live: true,  liveSymbol: 'bitcoin', displayOrder: 10 },
};

// Map verbose labels from your JSON to the conversational labels the component uses
const LABEL_OVERRIDES = {
  sp500:           'the S&P 500',
  median_home:     'a median American house',
  oil:             'a barrel of oil',
  silver:          'an ounce of silver',
  gasoline:        'a gallon of gasoline',
  new_car:         'an average new car',
  big_mac:         'a Big Mac',
  harvard_tuition: 'a year at Harvard',
  hours_of_work:   'an hour of American work',
  bitcoin:         '1 Bitcoin',
};

function buildAssets() {
  const out = {};
  const keys = Object.keys(historicalData.assets);

  // Sort by displayOrder if present, otherwise keep JSON order
  keys.sort((a, b) => {
    const oa = ASSET_ENRICHMENT[a]?.displayOrder ?? 999;
    const ob = ASSET_ENRICHMENT[b]?.displayOrder ?? 999;
    return oa - ob;
  });

  for (const key of keys) {
    const base = historicalData.assets[key];
    const enrich = ASSET_ENRICHMENT[key] || {};
    out[key] = {
      label: LABEL_OVERRIDES[key] || base.label,
      short: enrich.short || base.label,
      unit: enrich.unit || base.unit_plural || 'units',
      framing: base.framing,
      special: enrich.special,
      live: enrich.live || false,
      liveSymbol: enrich.liveSymbol,
      lastUpdated: enrich.lastUpdated || 'annually',
      // Convert string keys to number keys for clean indexing
      prices: Object.fromEntries(
        Object.entries(base.prices).map(([y, p]) => [Number(y), p])
      ),
    };
  }
  return out;
}

const GOLD_PRICES = Object.fromEntries(
  Object.entries(historicalData.gold_prices).map(([y, p]) => [Number(y), p])
);
const ASSETS = buildAssets();

// =====================================================================
// PALETTE — from Joe's TradingView indicators
// =====================================================================

const C = {
  bg: '#0D0D0D', panel: '#16162A', panelHi: '#1A1A2E',
  purple: '#774ABA', gold: '#ECA72C', bull: '#37854D', bear: '#D1495B',
  text: '#E8E8E8', muted: '#888899',
  grid: 'rgba(255,255,255,0.06)', border: 'rgba(255,255,255,0.08)',
};

// =====================================================================
// RATIO MATH
// ---------------------------------------------------------------------
// Display ratio = what shows in the hero number
//   how_many_oz  → assetPrice / gold (oz needed)
//   how_many_units → gold / assetPrice (units per oz)
// Chart value = always gold / assetPrice (line up = Gold winning)
// =====================================================================

function computeDisplayRatio(asset, gold, assetPrice) {
  if (asset.special === 'hours') return gold / assetPrice;
  if (asset.framing === 'how_many_oz') return assetPrice / gold;
  return gold / assetPrice;
}
function computeChartValue(asset, gold, assetPrice) {
  return gold / assetPrice;
}
function formatRatio(n, asset) {
  if (!isFinite(n) || n == null) return '—';
  if (asset.special === 'hours') return Math.round(n).toLocaleString() + ' hrs';
  if (asset.framing === 'how_many_oz') {
    if (n >= 100) return Math.round(n).toLocaleString() + ' oz';
    if (n >= 10)  return n.toFixed(1) + ' oz';
    if (n >= 1)   return n.toFixed(2) + ' oz';
    return n.toFixed(3) + ' oz';
  }
  if (n >= 100) return Math.round(n).toLocaleString();
  if (n >= 10)  return n.toFixed(1);
  if (n >= 1)   return n.toFixed(2);
  return n.toFixed(3);
}
function formatHeroSuffix(asset) {
  if (asset.special === 'hours') return 'to earn one ounce of Gold';
  if (asset.framing === 'how_many_oz') return 'for ' + asset.label;
  return asset.unit + ' per ounce';
}

function buildContextLine(latest, year2000Point, asset) {
  if (!latest || !year2000Point) return '';
  const chartRatio = latest.chartValue / year2000Point.chartValue;
  const display2000 = formatRatio(year2000Point.displayRatio, asset);
  const displayWentDown = latest.displayRatio < year2000Point.displayRatio;
  const prefix = displayWentDown ? 'down from' : 'up from';

  if (chartRatio > 1.02) {
    const pct = Math.round((chartRatio - 1) * 100);
    return `${prefix} ${display2000} in 2000 — Gold has strengthened ${pct}% vs ${asset.label}`;
  } else if (chartRatio < 0.98) {
    const pct = Math.round((1 - chartRatio) * 100);
    return `${prefix} ${display2000} in 2000 — ${asset.label} has outpaced Gold by ${pct}%`;
  }
  return `roughly unchanged from 2000 (${display2000})`;
}

// =====================================================================
// TOOLTIP
// =====================================================================

function CustomTooltip({ active, payload, asset }) {
  if (!active || !payload || !payload.length) return null;
  const d = payload[0].payload;
  const yearLabel = d.isLive ? 'now' : d.year;
  return (
    <div className="gve-tooltip">
      <div className="gve-tooltip-year">{yearLabel}</div>
      <div className="gve-tooltip-value">{formatRatio(d.displayRatio, asset)}</div>
      <div className="gve-tooltip-sub">
        Gold ${Math.round(d.goldPrice).toLocaleString()} · {asset.short} ${d.assetPrice < 10 ? d.assetPrice.toFixed(2) : Math.round(d.assetPrice).toLocaleString()}
      </div>
    </div>
  );
}

// =====================================================================
// MAIN COMPONENT
// =====================================================================

export default function GoldVsEverythingCalculator() {
  const assetKeys = Object.keys(ASSETS);

  const getInitialAsset = () => {
    if (typeof window === 'undefined') return 'sp500';
    const hash = window.location.hash.replace('#', '');
    const param = new URLSearchParams(window.location.search).get('asset');
    const candidate = hash || param;
    return assetKeys.includes(candidate) ? candidate : 'sp500';
  };

  const [selectedKey, setSelectedKey] = useState(getInitialAsset);
  const [livePrices, setLivePrices] = useState(null);
  const [copiedShare, setCopiedShare] = useState(false);

  const asset = ASSETS[selectedKey];

  // Fetch live prices from the GitHub-Action-maintained file
  useEffect(() => {
    fetch('/data/latest-prices.json')
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setLivePrices(data); })
      .catch(() => { /* graceful fallback: chart still shows up to latest annual */ });
  }, []);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.history.replaceState(null, '', '#' + selectedKey);
    }
  }, [selectedKey]);

  const chartData = useMemo(() => {
    const years = Object.keys(asset.prices).map(Number).sort((a, b) => a - b);
    const pts = years.map(year => {
      const g = GOLD_PRICES[year];
      const a = asset.prices[year];
      if (!g || !a) return null;
      return {
        year, goldPrice: g, assetPrice: a,
        chartValue: computeChartValue(asset, g, a),
        displayRatio: computeDisplayRatio(asset, g, a),
        isLive: false,
      };
    }).filter(Boolean);

    if (asset.live && livePrices?.gold?.price && livePrices[asset.liveSymbol]?.price) {
      const g = livePrices.gold.price;
      const a = livePrices[asset.liveSymbol].price;
      pts.push({
        year: 2026.3,
        goldPrice: g, assetPrice: a,
        chartValue: computeChartValue(asset, g, a),
        displayRatio: computeDisplayRatio(asset, g, a),
        isLive: true,
      });
    }
    return pts;
  }, [asset, livePrices, selectedKey]);

  const latest = chartData[chartData.length - 1];
  const historicalOnly = chartData.filter(p => !p.isLive);

  const peakPoint = useMemo(
    () => historicalOnly.reduce((b, p) => p.chartValue > b.chartValue ? p : b, historicalOnly[0]),
    [historicalOnly]
  );
  const troughPoint = useMemo(
    () => historicalOnly.reduce((w, p) => p.chartValue < w.chartValue ? p : w, historicalOnly[0]),
    [historicalOnly]
  );

  const contextLine = useMemo(() => {
    const y2000 = historicalOnly.find(p => p.year === 2000);
    return buildContextLine(latest, y2000, asset);
  }, [latest, historicalOnly, asset]);

  const handleShare = () => {
    const url = window.location.origin + window.location.pathname + '#' + selectedKey;
    navigator.clipboard.writeText(url).then(() => {
      setCopiedShare(true);
      setTimeout(() => setCopiedShare(false), 2000);
    }).catch(() => {
      const el = document.createElement('textarea');
      el.value = url;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      setCopiedShare(true);
      setTimeout(() => setCopiedShare(false), 2000);
    });
  };

  const liveDate = livePrices?.updatedAt
    ? new Date(livePrices.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : '';

  return (
    <div style={styles.root}>
      <style>{cssBlock}</style>
      <div className="gve-dot-grid" />
      <div style={styles.container}>
        {/* Masthead */}
        <div style={styles.masthead}>
          <div style={styles.eyebrow}>gold vs everything</div>
          <h1 style={styles.title}>one ounce of Gold<br/>buys how much?</h1>
          <p style={styles.subtitle}>measured against the stuff that actually matters</p>
        </div>

        {/* Asset selector pills */}
        <div className="gve-pills-container" style={styles.pills}>
          {assetKeys.map(k => (
            <button
              key={k}
              className={'gve-pill ' + (selectedKey === k ? 'active' : '')}
              onClick={() => setSelectedKey(k)}
            >{ASSETS[k].short}</button>
          ))}
        </div>

        {/* Hero */}
        <div style={styles.heroPanel}>
          <div style={styles.heroLabel}>
            {latest?.isLive
              ? <span><span className="gve-live-dot"/>live · {liveDate}</span>
              : <span style={{color:C.muted}}>updated {asset.lastUpdated}</span>
            }
          </div>
          <div className="gve-hero-number">
            {latest ? formatRatio(latest.displayRatio, asset) : '—'}
          </div>
          <div style={styles.heroSuffix}>{formatHeroSuffix(asset)}</div>
          <div style={styles.contextLine}>{contextLine}</div>
        </div>

        {/* Chart */}
        <div style={styles.chartPanel}>
          <div style={styles.chartHeader}>
            <div>
              <div style={styles.chartTitle}>gold's purchasing power since 1971</div>
              <div style={styles.chartSubtitle}>higher line = Gold is winning</div>
            </div>
            <button className="gve-share-btn" onClick={handleShare}>
              {copiedShare ? '✓ copied' : 'share →'}
            </button>
          </div>

          <div style={{width:'100%', height:340}}>
            <ResponsiveContainer>
              <AreaChart data={chartData} margin={{top:10,right:30,left:5,bottom:10}}>
                <defs>
                  <linearGradient id="goldGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={C.purple} stopOpacity={0.4}/>
                    <stop offset="50%" stopColor={C.purple} stopOpacity={0.12}/>
                    <stop offset="100%" stopColor={C.purple} stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid stroke={C.grid} strokeDasharray="2 4" vertical={false}/>
                <XAxis
                  dataKey="year" type="number" domain={[1971, 2027]}
                  ticks={[1971, 1980, 1990, 2000, 2010, 2020, 2026]}
                  tickFormatter={v => v >= 2026 ? "'26" : "'" + String(v).slice(2)}
                  tick={{fill:C.muted, fontSize:11, fontFamily:'JetBrains Mono'}}
                  axisLine={{stroke:C.border}} tickLine={false}
                />
                <YAxis
                  tick={{fill:C.muted, fontSize:11, fontFamily:'JetBrains Mono'}}
                  axisLine={false} tickLine={false}
                  tickFormatter={v =>
                    v >= 1000 ? (v/1000).toFixed(1)+'k'
                    : v >= 10 ? v.toFixed(0)
                    : v >= 1 ? v.toFixed(1)
                    : v.toFixed(2)
                  }
                  width={50}
                />
                <Tooltip content={<CustomTooltip asset={asset}/>}
                  cursor={{stroke:C.purple, strokeWidth:1, strokeDasharray:'3 3'}}/>
                <Area type="monotone" dataKey="chartValue"
                  stroke={C.purple} strokeWidth={2.5}
                  fill="url(#goldGradient)" dot={false}
                  activeDot={{r:5, fill:C.gold, stroke:C.bg, strokeWidth:2}}
                  isAnimationActive={true} animationDuration={800}/>
                {latest && latest.isLive && (
                  <ReferenceDot x={latest.year} y={latest.chartValue}
                    r={6} fill={C.gold} stroke={C.bg} strokeWidth={2} isFront/>
                )}
              </AreaChart>
            </ResponsiveContainer>
          </div>

          <div style={styles.chartFooter}>
            <div style={styles.footStat}>
              <div style={styles.footLabel}>peak Gold strength</div>
              <div style={styles.footValue}>
                {peakPoint ? formatRatio(peakPoint.displayRatio, asset) : '—'}
                <span style={styles.footYear}>·&nbsp;{peakPoint?.year}</span>
              </div>
            </div>
            <div style={styles.footStat}>
              <div style={styles.footLabel}>weakest vs asset</div>
              <div style={styles.footValue}>
                {troughPoint ? formatRatio(troughPoint.displayRatio, asset) : '—'}
                <span style={styles.footYear}>·&nbsp;{troughPoint?.year}</span>
              </div>
            </div>
            <div style={styles.footStat}>
              <div style={styles.footLabel}>today</div>
              <div style={{...styles.footValue, color:C.gold}}>
                {latest ? formatRatio(latest.displayRatio, asset) : '—'}
              </div>
            </div>
          </div>
        </div>

        {/* CTA — single button, aligned with the actual Gold Trader system */}
        <div style={styles.ctaFooter}>
          <div style={styles.ctaQuote}>
            stacking Gold is defensive.<br/>trading it is offensive.
          </div>
          <p style={styles.ctaBody}>
            the complete Gold system. built from 13 years trading it full-time.
          </p>
          <div>
            <a className="gve-cta-btn"
              href="https://goldtrader.substack.com"
              target="_blank" rel="noopener noreferrer">
              read the gold trader →
            </a>
          </div>
          <div style={styles.ctaMeta}>
            Gold: LBMA PM Fix, annual averages 1971–2025. Housing: FRED MSPUS. Live spot via Yahoo Finance, daily. Not financial advice.
          </div>
        </div>
      </div>
    </div>
  );
}

// =====================================================================
// STYLES
// =====================================================================

const styles = {
  root: {
    minHeight: '100vh',
    background: C.bg,
    color: C.text,
    fontFamily: "'DM Sans', -apple-system, sans-serif",
    padding: '48px 20px',
    position: 'relative',
    overflow: 'hidden',
  },
  container: { maxWidth: 920, margin: '0 auto', position: 'relative', zIndex: 1 },
  masthead: { textAlign: 'center', marginBottom: 48 },
  eyebrow: {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 11,
    letterSpacing: '0.2em',
    color: C.gold,
    textTransform: 'uppercase',
    marginBottom: 16,
    opacity: 0.8,
  },
  title: {
    fontFamily: "'DM Sans', sans-serif",
    fontSize: 'clamp(2rem, 5vw, 3.2rem)',
    fontWeight: 700,
    lineHeight: 1.1,
    letterSpacing: '-0.02em',
    color: C.text,
    margin: '0 0 16px 0',
  },
  subtitle: {
    color: C.muted,
    fontSize: 16,
    lineHeight: 1.6,
    margin: 0,
    fontStyle: 'italic',
  },
  pills: {
    display: 'flex', gap: 10,
    overflowX: 'auto',
    paddingBottom: 12,
    marginBottom: 32,
    WebkitOverflowScrolling: 'touch',
  },
  heroPanel: {
    background: `linear-gradient(180deg, ${C.panelHi} 0%, ${C.panel} 100%)`,
    border: `1px solid ${C.border}`,
    borderRadius: 20,
    padding: '56px 32px 48px',
    textAlign: 'center',
    marginBottom: 24,
    position: 'relative',
    overflow: 'hidden',
  },
  heroLabel: {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 11,
    letterSpacing: '0.12em',
    color: C.muted,
    textTransform: 'uppercase',
    marginBottom: 24,
  },
  heroSuffix: { color: C.text, fontSize: 18, marginTop: 20, fontWeight: 400 },
  contextLine: {
    color: C.muted, fontSize: 14, marginTop: 14,
    fontStyle: 'italic',
    maxWidth: 560,
    marginLeft: 'auto', marginRight: 'auto',
    lineHeight: 1.5,
  },
  chartPanel: {
    background: C.panel,
    border: `1px solid ${C.border}`,
    borderRadius: 20,
    padding: '28px 24px 20px',
    marginBottom: 32,
  },
  chartHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 20,
    gap: 16,
    flexWrap: 'wrap',
  },
  chartTitle: {
    fontFamily: "'DM Sans', sans-serif",
    fontSize: 15, fontWeight: 500,
    color: C.text, marginBottom: 4,
  },
  chartSubtitle: {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 11, color: C.muted, letterSpacing: '0.05em',
  },
  chartFooter: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: 12, marginTop: 16, paddingTop: 20,
    borderTop: `1px solid ${C.border}`,
  },
  footStat: { textAlign: 'left' },
  footLabel: {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 10, letterSpacing: '0.12em',
    color: C.muted, textTransform: 'uppercase',
    marginBottom: 6,
  },
  footValue: {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 15, fontWeight: 500, color: C.text,
  },
  footYear: {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 11, color: C.muted, marginLeft: 6, fontWeight: 400,
  },
  ctaFooter: {
    textAlign: 'center',
    padding: '56px 24px 32px',
    borderTop: `1px solid ${C.border}`,
    marginTop: 16,
  },
  ctaQuote: {
    fontFamily: "'DM Sans', sans-serif",
    fontSize: 22, fontWeight: 500, color: C.text,
    marginBottom: 16, lineHeight: 1.4,
    maxWidth: 560, marginLeft: 'auto', marginRight: 'auto',
    letterSpacing: '-0.01em',
  },
  ctaBody: { fontSize: 15, color: C.muted, marginBottom: 32, fontStyle: 'italic' },
  ctaMeta: {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: 10, color: C.muted, marginTop: 40,
    opacity: 0.5, letterSpacing: '0.03em', lineHeight: 1.6,
    maxWidth: 600, marginLeft: 'auto', marginRight: 'auto',
  },
};

// Injected into the page via <style> so Recharts animations and custom classes work
const cssBlock = `
@import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&family=DM+Sans:wght@400;500;700&display=swap');

@keyframes pulse-dot {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.4; transform: scale(1.3); }
}
@keyframes fade-up {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}

.gve-hero-number {
  font-family: 'JetBrains Mono', monospace;
  font-weight: 700;
  font-size: clamp(3rem, 9vw, 6rem);
  line-height: 1;
  letter-spacing: -0.04em;
  color: #ECA72C;
  text-shadow: 0 0 40px rgba(236, 167, 44, 0.25), 0 0 80px rgba(119, 74, 186, 0.15);
  animation: fade-up 0.5s ease-out;
}
.gve-pill {
  font-family: 'DM Sans', sans-serif; font-size: 14px;
  padding: 10px 18px; border-radius: 999px;
  background: transparent; color: #888899;
  border: 1px solid rgba(255,255,255,0.1);
  cursor: pointer; transition: all 0.2s ease;
  white-space: nowrap; font-weight: 500;
}
.gve-pill:hover {
  color: #E8E8E8;
  border-color: rgba(119, 74, 186, 0.5);
  background: rgba(119, 74, 186, 0.08);
}
.gve-pill.active {
  color: #E8E8E8;
  background: rgba(119, 74, 186, 0.15);
  border-color: #774ABA;
  box-shadow: 0 0 20px rgba(119, 74, 186, 0.25);
}
.gve-pills-container::-webkit-scrollbar { height: 4px; }
.gve-pills-container::-webkit-scrollbar-track { background: transparent; }
.gve-pills-container::-webkit-scrollbar-thumb { background: rgba(119, 74, 186, 0.3); border-radius: 2px; }
.gve-live-dot {
  display: inline-block;
  width: 8px; height: 8px;
  border-radius: 50%;
  background: #37854D;
  animation: pulse-dot 2s ease-in-out infinite;
  margin-right: 8px;
  box-shadow: 0 0 12px #37854D;
}
.gve-share-btn {
  font-family: 'DM Sans', sans-serif; font-size: 13px;
  padding: 10px 18px;
  background: transparent; color: #888899;
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 8px;
  cursor: pointer; transition: all 0.2s;
  font-weight: 500;
}
.gve-share-btn:hover {
  color: #E8E8E8;
  border-color: #ECA72C;
  background: rgba(236, 167, 44, 0.05);
}
.gve-cta-btn {
  font-family: 'DM Sans', sans-serif;
  display: inline-block;
  padding: 16px 32px;
  background: #ECA72C;
  color: #0D0D0D;
  border-radius: 10px;
  text-decoration: none;
  font-weight: 700;
  font-size: 16px;
  letter-spacing: -0.01em;
  transition: all 0.2s;
}
.gve-cta-btn:hover {
  background: #ffbe4a;
  transform: translateY(-1px);
  box-shadow: 0 12px 32px rgba(236, 167, 44, 0.3);
}
.gve-dot-grid {
  position: absolute;
  inset: 0;
  background-image: radial-gradient(circle at 1px 1px, rgba(255,255,255,0.04) 1px, transparent 0);
  background-size: 24px 24px;
  pointer-events: none;
  z-index: 0;
}
.gve-tooltip {
  background: rgba(22, 22, 42, 0.95);
  backdrop-filter: blur(12px);
  border: 1px solid rgba(119, 74, 186, 0.3);
  border-radius: 10px;
  padding: 12px 14px;
  font-family: 'DM Sans', sans-serif;
  font-size: 13px;
  color: #E8E8E8;
  box-shadow: 0 8px 32px rgba(0,0,0,0.5);
}
.gve-tooltip-year {
  font-family: 'JetBrains Mono', monospace;
  font-size: 11px;
  color: #ECA72C;
  letter-spacing: 0.05em;
  margin-bottom: 6px;
  text-transform: uppercase;
}
.gve-tooltip-value {
  font-family: 'JetBrains Mono', monospace;
  font-size: 16px;
  color: #E8E8E8;
  font-weight: 700;
  margin-bottom: 4px;
}
.gve-tooltip-sub { color: #888899; font-size: 11px; }
`;
