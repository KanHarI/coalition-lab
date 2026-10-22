"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowDownToLine, ArrowRight, Check, ChevronDown, ExternalLink, Info, Link2, Plus, RefreshCw, Search, SlidersHorizontal, X } from "lucide-react";
import { coalitionDistribution, fitPartyModel, partyDistribution, PRESETS, quantile, summarize, type DirichletFit, type Distribution, type MarketData, type PartyMarket } from "@/lib/model";

type Tab = "lab" | "markets" | "method";
const pct = (n: number, digits = 1) => `${(Math.max(0, Math.min(1, n)) * 100).toFixed(digits)}%`;
const stamp = (value: string) => `${value.slice(0, 16).replace("T", " ")} UTC`;
const money = (n: number) => new Intl.NumberFormat("en-US", { notation: "compact", style: "currency", currency: "USD", maximumFractionDigits: 1 }).format(n);

function Mark({ small = false }: { small?: boolean }) {
  return <svg width={small ? 26 : 34} height={small ? 26 : 34} viewBox="0 0 34 34" fill="none" aria-hidden="true"><rect width="34" height="34" rx="8" fill="#173f35"/><path d="M8 24V11h3l6 7 6-7h3v13h-4v-6l-5 6-5-6v6Z" fill="#e4eed9"/></svg>;
}

function SeatChart({ pmf, target }: { pmf: Distribution; target: number }) {
  const [mode, setMode] = useState<"pmf" | "cdf">("pmf");
  const [hovered, setHovered] = useState<number | null>(null);
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 520px)");
    const update = () => setCompact(media.matches);
    update(); media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const width = compact ? 420 : 840, height = compact ? 260 : 300, left = 44, right = 14, top = 30, bottom = 38;
  const plotW = width - left - right, plotH = height - top - bottom;
  const maxSeat = Math.min(120, Math.ceil(Math.max(target + 15, quantile(pmf, .995)) / 10) * 10);
  const values: number[] = [];
  let cumulative = 0;
  for (let seat = 0; seat <= maxSeat; seat++) {
    cumulative += pmf[seat] || 0;
    values.push(mode === "cdf" ? cumulative : pmf[seat] || 0);
  }
  const maxP = mode === "cdf" ? 1 : Math.max(.01, ...values) * 1.12;
  const x = (seat: number) => left + (seat + .5) / (maxSeat + 1) * plotW;
  const y = (p: number) => top + plotH * (1 - p / maxP);
  const barW = plotW / (maxSeat + 1);
  const path = values.map((p, seat) => `${seat ? "L" : "M"}${x(seat)},${y(p)}`).join(" ");
  const omitted = pmf.slice(maxSeat + 1).reduce((a, b) => a + b, 0);
  const hoveredSeat = hovered === null ? null : Math.min(hovered, maxSeat);
  return <div className="chart-section">
    <div className="section-heading"><div><span className="eyebrow">THE FULL PICTURE</span><h2>Coalition seat distribution</h2></div><div className="segmented" aria-label="Chart view"><button aria-pressed={mode === "pmf"} onClick={() => setMode("pmf")}>Probability</button><button aria-pressed={mode === "cdf"} onClick={() => setMode("cdf")}>Cumulative</button></div></div>
    <div className="chart-legend"><span><i className="legend-dot muted-dot"/>Below {target} seats</span><span><i className="legend-dot green-dot"/>{target}+ seats</span><span className="chart-unit">{mode === "pmf" ? "Probability of each seat total" : "Probability of at most this many seats"}</span></div>
    <div className="chart-wrap">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Coalition ${mode === "pmf" ? "probability distribution" : "cumulative distribution"}. ${pct(summarize(pmf, target).majority)} probability of at least ${target} seats. Exact probabilities are available below.`} onMouseLeave={() => setHovered(null)}>
        <rect x={x(target) - barW / 2} y={top} width={width - right - x(target) + barW / 2} height={plotH} fill="#f5f8f2"/>
        {[0, 1, 2, 3, 4].map(i => { const p = maxP * i / 4; return <g key={i}><line x1={left} x2={width - right} y1={y(p)} y2={y(p)} stroke="#e8ece4" strokeDasharray={i === 0 ? "0" : "3 4"}/><text x={left - 10} y={y(p) + 4} textAnchor="end" className="axis-label">{(p * 100).toFixed(mode === "cdf" ? 0 : 1)}%</text></g>; })}
        {mode === "pmf" ? values.map((p, seat) => p > 0 && <rect key={seat} x={x(seat) - barW * .43} y={y(p)} width={Math.max(.5, barW * .86)} height={Math.max(0, y(0) - y(p))} rx={barW > 5 ? 1.5 : 0} fill={seat >= target ? "#285847" : "#b8c8b4"} opacity={hoveredSeat === null || hoveredSeat === seat ? 1 : .65}/>) : <><path d={`${path} L${x(maxSeat)},${y(0)} L${x(0)},${y(0)} Z`} fill="#285847" opacity=".09"/><path d={path} fill="none" stroke="#285847" strokeWidth="2.5"/></>}
        <line x1={x(target) - barW / 2} x2={x(target) - barW / 2} y1={top - 5} y2={y(0)} stroke="#315c48" strokeDasharray="5 4"/>
        <text x={x(target) > width * .7 ? x(target) - 7 : x(target) + 7} textAnchor={x(target) > width * .7 ? "end" : "start"} y={top - 13} className="threshold-label">{target} · {target === 61 ? "MAJORITY" : "TARGET"}</text>
        {Array.from({ length: compact ? 5 : 7 }, (_, i) => Math.round(i * maxSeat / (compact ? 4 : 6))).map(n => <text key={n} x={x(n)} y={height - 16} textAnchor="middle" className="axis-label">{n}</text>)}
        {hoveredSeat !== null && <line x1={x(hoveredSeat)} x2={x(hoveredSeat)} y1={top} y2={y(0)} stroke="#789078" opacity=".7"/>}
        <rect x={left} y={top} width={plotW} height={plotH} fill="transparent" onMouseMove={e => { const rect = e.currentTarget.getBoundingClientRect(); setHovered(Math.min(maxSeat, Math.max(0, Math.floor((e.clientX - rect.left) / rect.width * (maxSeat + 1))))); }}/>
      </svg>
      {hoveredSeat !== null && <div className="chart-tooltip" style={{ left: `${Math.max(12, Math.min(82, (x(hoveredSeat) / width) * 100))}%` }}><strong>{mode === "cdf" ? "≤ " : ""}{hoveredSeat} seats</strong><span>{pct(values[hoveredSeat], 2)} probability</span></div>}
    </div>
    <div className="chart-footer"><span>Number of seats →</span><span>{omitted > .00001 ? `${pct(1 - omitted, 2)} of probability shown · upper tail retained in all calculations` : "All probability shown"}</span></div>
    <details className="probability-table"><summary>View exact probabilities <ChevronDown size={13}/></summary><div className="table-scroll"><table><thead><tr><th>Seats</th><th>Probability</th><th>At least this many</th></tr></thead><tbody>{pmf.map((p, n) => p > .0000001 && <tr key={n}><td>{n}</td><td>{pct(p, 4)}</td><td>{pct(pmf.slice(n).reduce((a, b) => a + b, 0), 4)}</td></tr>)}</tbody></table></div></details>
  </div>;
}

function PartyDetails({ party, fit }: { party: PartyMarket; fit: DirichletFit }) {
  const summary = summarize(partyDistribution(fit, party.id));
  const fitted = fit.parties.find(p => p.id === party.id)!;
  return <details className="market-card">
    <summary><div className="market-name"><i className="party-dot" style={{ background: party.color }}/><strong>{party.name}</strong>{party.closed && <span className="tag">Closed</span>}</div><span className="market-stat"><strong>{summary.mean.toFixed(1)}</strong> expected seats</span><span className="market-volume">{money(party.volume)} volume</span><ChevronDown size={16}/></summary>
    <div className="market-detail"><div className="bucket-grid">{party.buckets.map((bucket, index) => { return <div className="bucket" key={bucket.label}><span>{bucket.label} seats</span><strong>{pct(bucket.probability)}</strong><div className="mini-track"><i style={{ width: `${bucket.probability * 100}%`, background: party.color }}/></div><small>Quoted: {pct(bucket.price)}<br/>Fitted: {pct(fitted.probabilities[index])}<br/>Difference: {fitted.residuals[index] >= 0 ? "+" : ""}{(100 * fitted.residuals[index]).toFixed(1)} pp</small></div>; })}</div><div className="market-notes"><p>Quoted prices sum to <strong>{(party.priceSum * 100).toFixed(2)}%</strong>. The large percentages are normalized market prices. Fitted probabilities come from the shared Dirichlet–multinomial model and may differ. Expected seats use the fitted model.</p><a href={`https://polymarket.com/event/${party.slug}`} target="_blank" rel="noreferrer">View source market <ExternalLink size={13}/></a></div><details className="rules"><summary>Market resolution rules</summary><p>{party.rules}</p><p>Source last updated: {party.updatedAt ? stamp(party.updatedAt) : "Not supplied"}</p></details></div>
  </details>;
}

export default function CoalitionLab({ initialData }: { initialData: MarketData }) {
  const [data, setData] = useState(initialData);
  const [tab, setTab] = useState<Tab>("lab");
  const [selected, setSelected] = useState<string[]>(PRESETS[0].parties);
  const [target, setTarget] = useState(61);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState("");
  const [ready, setReady] = useState(false);
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(process.env.NEXT_PUBLIC_MARKETS_URL || "/markets.json", { signal: AbortSignal.timeout(16000), cache: "no-cache" });
      if (!response.ok) throw new Error("Market data unavailable");
      const next = await response.json() as MarketData;
      if (!Array.isArray(next.parties) || next.parties.length !== initialData.parties.length || !Number.isFinite(Date.parse(next.fetchedAt))) throw new Error("Incomplete data");
      setData(next);
    } catch { setData(previous => ({ ...previous, source: "snapshot", warning: "Refresh unavailable. The displayed prices and their original retrieval time have been retained." })); }
    finally { setLoading(false); }
  }, [initialData.parties.length]);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.has("parties")) setSelected((params.get("parties") || "").split(",").filter(id => initialData.parties.some(p => p.id === id)));
    const threshold = Number(params.get("target"));
    if (Number.isInteger(threshold) && threshold >= 1 && threshold <= 120) setTarget(threshold);
    setReady(true);
    void refresh();
    const interval = setInterval(() => void refresh(), 1200000);
    return () => clearInterval(interval);
  }, [initialData.parties, refresh]);
  useEffect(() => {
    if (!ready) return;
    const url = new URL(window.location.href);
    url.searchParams.set("parties", selected.join(","));
    url.searchParams.delete("tails");
    url.searchParams.set("model", "dirichlet-multinomial-v1");
    url.searchParams.set("target", String(target));
    window.history.replaceState(null, "", url);
  }, [selected, target, ready]);
  useEffect(() => { if (notice) { const timer = setTimeout(() => setNotice(""), 3500); return () => clearTimeout(timer); } }, [notice]);
  const fit = useMemo(() => fitPartyModel(data.parties), [data.parties]);
  const pmf = useMemo(() => coalitionDistribution(fit, selected), [fit, selected]);
  const stats = useMemo(() => summarize(pmf, target), [pmf, target]);
  const allStats = useMemo(() => summarize(coalitionDistribution(fit, data.parties.map(p => p.id))), [data.parties, fit]);
  const comparisons = useMemo(() => PRESETS.map(p => ({ ...p, stats: summarize(coalitionDistribution(fit, p.parties), target) })), [fit, target]);
  const means = useMemo(() => Object.fromEntries(data.parties.map(p => [p.id, summarize(partyDistribution(fit, p.id)).mean])), [data.parties, fit]);
  const rankedParties = useMemo(() => [...data.parties].sort((a, b) => means[b.id] - means[a.id] || a.name.localeCompare(b.name, "en")), [data.parties, means]);
  const activePreset = PRESETS.find(p => p.parties.length === selected.length && p.parties.every(id => selected.includes(id)));
  const visibleParties = rankedParties.filter(p => p.name.toLowerCase().includes(search.toLowerCase()));
  const toggle = (id: string) => setSelected(previous => previous.includes(id) ? previous.filter(p => p !== id) : [...previous, id]);
  const exportData = () => {
    const file = new Blob([JSON.stringify({ model: fit.model, totalSeats: fit.totalSeats, target, selected, fetchedAt: data.fetchedAt, source: data.source, assumptions: "Shares follow Dirichlet(alpha); seats given shares follow Multinomial(120, shares). All tracked lists are assumed disjoint and exhaustive. Reservists–New Economic Party is omitted: its vote-share market has not been converted to seat probabilities. Results are conditional on all seats going to the tracked lists. Alpha is jointly fitted by unweighted least squares to normalized market bracket probabilities. No electoral threshold or official seat-allocation simulation.", fit, summary: stats, distribution: pmf, markets: data.parties }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(file); const link = document.createElement("a"); link.href = url; link.download = "mandate-coalition.json"; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice("Scenario and probability data exported.");
  };
  const share = async () => {
    try { await navigator.clipboard.writeText(window.location.href); setNotice("Scenario link copied. The latest saved prices load when it is opened."); }
    catch { setNotice("Copy the address bar to share this scenario."); }
  };

  return <>
    <header className="site-header"><div className="header-inner"><a className="brand" href="/" aria-label="Mandate home"><Mark/><span>mandate<span className="brand-period">.</span></span></a><span className="edition">ISRAEL 2026</span><nav aria-label="Main navigation">{([{ id: "lab", label: "Coalition lab" }, { id: "markets", label: "Market data" }, { id: "method", label: "Methodology" }] as { id: Tab; label: string }[]).map(item => <button key={item.id} aria-current={tab === item.id ? "page" : undefined} onClick={() => setTab(item.id)}>{item.label}</button>)}</nav><a className="source-link" href="https://polymarket.com/event/israel-election-likud-of-seats" target="_blank" rel="noreferrer">Powered by market data <ExternalLink size={13}/></a></div></header>
    <main>
      <section className="hero"><div><div className="hero-kicker"><span className="tiny-line"/>THE KNESSET, THROUGH THE MARKETS</div><h1>{tab === "lab" ? <>Every seat changes<br/>the possibilities<span className="green-text">.</span></> : tab === "markets" ? <>Behind every<br/>probability<span className="green-text">.</span></> : <>Make the assumptions<br/>part of the picture<span className="green-text">.</span></>}</h1><p>{tab === "lab" ? "Build a coalition. Explore its range of outcomes. See what it takes to reach a majority." : tab === "markets" ? "Explore the source prices and the distributions reconstructed from them." : "A joint model of party shares and seats, with its assumptions and fit visible."}</p></div><div className="majority-motif" aria-label="61 of 120 seats is a Knesset majority"><div className="motif-arc">{Array.from({ length: 31 }, (_, i) => <i key={i} style={{ transform: `rotate(${-90 + i * 6}deg) translateY(-83px)`, background: i < 16 ? "#315b47" : "#d8dfcf" }}/>)}</div><div className="motif-number">61<span>/ 120</span></div><span className="motif-label">THE MAJORITY LINE</span></div></section>
      <div className="data-strip"><div className="data-status"><i className={`status-dot ${data.source === "live" ? "live" : "snapshot"}`}/><strong>{data.source === "live" ? "Polymarket prices" : "Market snapshot"}</strong><span className="separator">/</span><span>{data.parties.length} party markets</span><span className="retrieved">Last updated on <time dateTime={data.fetchedAt}>{stamp(data.fetchedAt)}</time></span></div><button className="text-button" onClick={refresh} disabled={loading}><RefreshCw size={13} className={loading ? "spin" : ""}/>{loading ? "Checking…" : "Check for updates"}</button></div>
      {data.warning && <div className="data-warning" role="status"><Info size={15}/>{data.warning}</div>}
      {fit.warnings.map(warning => <div className="data-warning" role="status" key={warning}><Info size={15}/>{warning}</div>)}
      <div className="data-warning" role="status"><Info size={15}/><span>Coverage gap: המילואימניקים והכלכלית (Reservists–New Economic Party) is not included in the seat model. Its available <a href="https://polymarket.com/event/israel-election-reservistsnew-economic-party-vote-share" target="_blank" rel="noreferrer">vote-share market</a> needs an electoral-threshold and seat-allocation model. Current results allocate all 120 seats to the {data.parties.length} tracked lists.</span></div>
      {tab === "lab" && <>
        <div className="workspace-heading"><div><h2>Coalition builder</h2><span>Your selection, your scenario.</span></div><div className="toolbar"><button className="model-pill" onClick={() => setTab("method")}><span className="small-dot"/>Dirichlet–multinomial <SlidersHorizontal size={13}/></button><button className="icon-button" title="Copy scenario link" aria-label="Copy scenario link" onClick={share}><Link2 size={17}/></button><button className="icon-button" title="Export scenario and probability data" aria-label="Export scenario and probability data" onClick={exportData}><ArrowDownToLine size={17}/></button></div></div>
        <div className="lab-grid"><aside className="party-panel"><div className="panel-top"><h3>Select parties <span>{selected.length}</span></h3><button className="text-button" onClick={() => setSelected([])}>Clear</button></div><label className="preset-label">START WITH A GROUPING<select aria-label="Coalition preset" value={activePreset?.id || "custom"} onChange={e => { const preset = PRESETS.find(p => p.id === e.target.value); if (preset) setSelected(preset.parties); }}><option value="custom">Custom coalition</option>{PRESETS.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label><div className="party-list-heading"><span>PARTY / LIST</span><span>EXP. SEATS</span></div><div className="party-list">{rankedParties.map(p => <label className={`party-row ${selected.includes(p.id) ? "selected" : ""}`} key={p.id}><input type="checkbox" checked={selected.includes(p.id)} onChange={() => toggle(p.id)}/><span className="custom-check">{selected.includes(p.id) && <Check size={12} strokeWidth={3}/>}</span><i className="party-dot" style={{ background: p.color }}/><span className="party-label">{p.name}</span><span className="party-mean">{means[p.id].toFixed(1)}</span></label>)}</div><div className="panel-bottom"><Info size={14}/><p>Groupings are editable examples, not predictions of who will govern.</p></div></aside>
          <div className="results"><div className="metric-grid" aria-live="polite"><div className="metric"><span>Expected seats</span><strong>{stats.mean.toFixed(1)}<small> seats</small></strong><p>Sum of party expectations</p></div><div className="metric"><span>90% probability interval</span><strong>{stats.low}<span className="metric-dash">–</span>{stats.high}</strong><p>5th to 95th percentile</p></div><div className="metric feature"><span>Chance of {target}+ seats <ArrowRight size={14}/></span><strong>{pct(stats.majority)}</strong><p>{target === 61 ? "Reaching a Knesset majority" : "Reaching your selected target"}</p></div></div>
          <div className="chart-card">{selected.length ? <SeatChart pmf={pmf} target={target}/> : <div className="empty-state"><Plus size={30}/><h2>A coalition starts with a party.</h2><p>Select parties on the left to explore their combined seat distribution.</p><button className="primary-button" onClick={() => setSelected(PRESETS[0].parties)}>Load example coalition <ArrowRight size={15}/></button></div>}</div>
          <div className="assumption-note"><Info size={16}/><div><strong>120 seats shared across the tracked lists.</strong><p>Party shares follow a Dirichlet distribution; seats are allocated multinomially. Bracket fit RMSE: {(fit.rmse * 100).toFixed(1)} percentage points. <button onClick={() => setTab("method")}>Review assumptions <ArrowRight size={12}/></button></p></div></div>
          <div className="target-control"><label htmlFor="target">Explore a seat threshold <strong>{target}</strong></label><input id="target" type="range" min="1" max="120" value={target} onChange={e => setTarget(Number(e.target.value))}/><button className="text-button" onClick={() => setTarget(61)}>Reset to 61</button></div></div></div>
        <section className="comparison-section"><div className="section-heading"><div><span className="eyebrow">OTHER POSSIBILITIES</span><h2>Compare a few starting points</h2></div><span className="subtle">Same prices. Same assumptions.</span></div><div className="comparison-grid">{comparisons.map(c => <button className={`comparison-card ${activePreset?.id === c.id ? "active" : ""}`} key={c.id} onClick={() => setSelected(c.parties)}><div className="comparison-title"><h3>{c.name}</h3><ArrowRight size={17}/></div><div className="party-dots">{c.parties.map(id => <i key={id} title={data.parties.find(p => p.id === id)?.name} style={{ background: data.parties.find(p => p.id === id)?.color }}/>)}</div><p>{c.description}</p><div className="comparison-numbers"><span><strong>{c.stats.mean.toFixed(1)}</strong> expected seats</span><span><strong>{pct(c.stats.majority)}</strong> {target}+ seats</span></div><div className="comparison-track"><span style={{ width: `${c.stats.majority * 100}%` }}/></div></button>)}</div></section>
      </>}
      {tab === "markets" && <section className="markets-section"><div className="section-heading"><div><span className="eyebrow">FOLLOW THE INPUTS</span><h2>{data.parties.length} lists. One shared source.</h2></div><label className="search-input"><Search size={16}/><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Find a party…" aria-label="Find a party"/>{search && <button aria-label="Clear search" onClick={() => setSearch("")}><X size={14}/></button>}</label></div><p className="intro-note">Expand a party to compare quoted prices, normalized market probabilities, and fitted probabilities. All parties share one 120-seat Dirichlet–multinomial model. <button className="inline-button" onClick={() => setTab("method")}>Review the fit</button></p><div className="market-list">{visibleParties.map(p => <PartyDetails key={p.id} party={p} fit={fit}/>)}{!visibleParties.length && <div className="empty-state"><Search size={24}/><p>No party matches “{search}”.</p><button className="text-button" onClick={() => setSearch("")}>Show all parties</button></div>}</div><div className="source-footnote"><Info size={16}/><p>Market rules can count an entire joint list or merged party. This catalog uses the {data.parties.length} listed seat events; check their rules before adding overlapping markets. A scheduled job refreshes these configured events every 20 minutes. Opening this page does not fetch Polymarket directly.</p></div></section>}
      {tab === "method" && <section className="method-layout"><div className="method-main">
        <span className="eyebrow">MODEL NOTES / DIRICHLET–MULTINOMIAL</span><h2>From market prices<br/>to coalition probabilities.</h2>
        <p className="method-intro">The markets describe individual parties. We fit them together as shares of a single 120-seat parliament.</p>
        <article className="method-step"><span className="step-number">01</span><div><h3>Normalize the market brackets</h3><p>For each party, divide each Yes price by the sum of its bracket prices. These probabilities are the fitting targets. Original prices remain visible under Market data.</p><code>p(bracket) = Yes price / Σ Yes prices</code><p className="subtle">Market prices are calibration targets, not observed vote counts. Normalization does not correct stale quotes, spreads, or thin liquidity.</p></div></article>
        <article className="method-step"><span className="step-number">02</span><div><h3>Fit a distribution over party shares</h3><p>A Dirichlet distribution gives each party a positive parameter α. Its expected share is α divided by the sum of all parameters. The sum, called concentration, controls how much those shares vary.</p><code>p ~ Dirichlet(α) · E[pᵢ] = αᵢ / Σα</code><p>We fit all parameters together, minimizing the sum of squared differences between normalized market probabilities and modeled bracket probabilities. Every bracket has equal weight. Open brackets retain their full 0–120 bounds; the fitted distribution determines their shape.</p><div className="diagnostic"><div><span>Fitted concentration · Σα</span><strong>{fit.concentration.toLocaleString("en-US", { maximumFractionDigits: 1 })}</strong></div><div><span>Bracket probability RMSE</span><strong>{(fit.rmse * 100).toFixed(2)} pp</strong></div><div><span>Largest bracket difference</span><strong>{(fit.maxError * 100).toFixed(2)} pp</strong></div></div><p className="subtle">A single joint model generally cannot match all quoted brackets exactly. Inspect the differences under Market data. Search limits or incomplete convergence are reported above.</p></div></article>
        <article className="method-step"><span className="step-number">03</span><div><h3>Allocate exactly 120 seats</h3><p>Given a set of shares, party seat counts follow a multinomial distribution with 120 seats. Integrating over the uncertain shares gives the Dirichlet–multinomial model. Larger concentration approaches a fixed-share multinomial model. It removes extra variation in the shares, but the seat allocation remains random. If market brackets are narrower than that multinomial allows, increasing concentration cannot reproduce them. Reaching the search limit signals a limitation of the fit, not certainty about the election.</p><code>Seats | p ~ Multinomial(120, p)</code><p>Every joint outcome totals 120. Party seat counts are negatively correlated: seats gained by one party must come from the others. All tracked lists are assumed to be disjoint and to cover the whole parliament.</p><div className="diagnostic"><div><span>All tracked parties, expected total</span><strong>{allStats.mean.toFixed(1)} seats</strong></div><div><span>All tracked parties, 90% interval</span><strong>{allStats.low}–{allStats.high} seats</strong></div><div><span>Selected coalition above 120</span><strong>{pct(stats.over120)}</strong></div></div><p className="subtle">This is a seat-count model. It does not simulate the electoral threshold, surplus-vote agreements, or official seat allocation, and can assign probability to 1–3 seats. Overlapping joint-list markets would violate its assumptions.</p></div></article>
        <article className="method-step"><span className="step-number">04</span><div><h3>Calculate coalition probabilities exactly</h3><p>Add the α parameters of selected parties into A, and those of the remaining parties into B. The coalition total follows a beta-binomial distribution. No random sampling is needed.</p><code>Coalition seats ~ BetaBinomial(120, A, B)</code><p>The empty coalition has zero seats; selecting every party gives 120 with certainty. Expected seats add, while uncertainty accounts for the dependence between parties. The interval runs from the 5th to the 95th percentile.</p></div></article>
      </div><aside className="method-aside"><div className="method-summary"><span className="eyebrow">CURRENT MODEL</span><h3>Shared seats.<br/>Joint uncertainty.<br/>Visible fit.</h3><ul><li><Check size={15}/>Real Polymarket source prices</li><li><Check size={15}/>Dirichlet party shares</li><li><Check size={15}/>Exactly 120 seats in total</li><li><Check size={15}/>Exact coalition probabilities</li></ul><p>These probabilities describe seat counts under the stated assumptions. They do not predict political compatibility or government formation.</p><button className="primary-button" onClick={() => setTab("lab")}>Explore the coalition lab <ArrowRight size={15}/></button></div><a className="documentation-link" href="https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.dirichlet_multinomial.html" target="_blank" rel="noreferrer">Dirichlet–multinomial reference <ExternalLink size={14}/></a></aside></section>}
      <footer><div className="footer-brand"><Mark small/><strong>mandate.</strong><span>A clearer view of the possibilities.</span></div><span>Independent analysis · Not affiliated with Polymarket</span><button onClick={() => setTab("method")}>Read the methodology <ArrowRight size={13}/></button></footer>
    </main>
    <div className={`toast ${notice ? "visible" : ""}`} role="status" aria-live="polite">{notice && <><Check size={16}/>{notice}</>}</div>
  </>;
}
