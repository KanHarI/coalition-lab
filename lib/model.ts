/** Pure probability model. Dependence strategies implement the same combine interface. */
export type TailMode = "full" | "adjacent";
export type Bucket = { label: string; low: number; high: number; open: "lower" | "upper" | null; price: number; probability: number };
export type PartyMarket = { id: string; slug: string; name: string; color: string; buckets: Bucket[]; priceSum: number; volume: number; updatedAt: string | null; closed: boolean; rules: string };
export type MarketData = { parties: PartyMarket[]; fetchedAt: string; source: "live" | "snapshot"; warning?: string };
export type Distribution = number[];

export const PARTY_META: Record<string, { name: string; color: string }> = {
  likud: { name: "Likud", color: "#315d9c" },
  yashar: { name: "Yashar", color: "#7c77bc" },
  together: { name: "Together", color: "#46a7a0" },
  shas: { name: "Shas", color: "#ad8951" },
  otzma: { name: "Otzma Yehudit", color: "#c77f5b" },
  "yisrael-beiteinu": { name: "Yisrael Beiteinu", color: "#7b9bb8" },
  dems: { name: "The Democrats", color: "#b76e8c" },
  utj: { name: "United Torah Judaism", color: "#8d8b69" },
  "rzp-zehut": { name: "RZP–Zehut", color: "#bc9a3e" },
  "joint-list": { name: "Joint List", color: "#709c6d" },
  raam: { name: "Ra’am", color: "#61a892" },
  "amcha-yisrael": { name: "Amcha Yisrael", color: "#9f8780" },
};

export const PRESETS = [
  { id: "likud", name: "Likud + partners", description: "Likud, Shas, UTJ, Otzma Yehudit, RZP–Zehut", parties: ["likud", "shas", "utj", "otzma", "rzp-zehut"] },
  { id: "alternative", name: "Alternative grouping", description: "Yashar, Together, Yisrael Beiteinu, The Democrats", parties: ["yashar", "together", "yisrael-beiteinu", "dems"] },
  { id: "broad", name: "Alternative + Ra’am", description: "Alternative grouping with Ra’am", parties: ["yashar", "together", "yisrael-beiteinu", "dems", "raam"] },
];

export function parseRange(label: string): Pick<Bucket, "low" | "high" | "open"> {
  const s = label.trim().replace(/[–—]/g, "-");
  let match: RegExpMatchArray | null;
  let result: Pick<Bucket, "low" | "high" | "open">;
  if ((match = s.match(/^<\s*(\d+)$/))) result = { low: 0, high: Number(match[1]) - 1, open: "lower" };
  else if ((match = s.match(/^(\d+)\s*\+$/))) result = { low: Number(match[1]), high: 120, open: "upper" };
  else if ((match = s.match(/^(\d+)\s*-\s*(\d+)$/))) result = { low: Number(match[1]), high: Number(match[2]), open: null };
  else if (/^\d+$/.test(s)) result = { low: Number(s), high: Number(s), open: null };
  else throw new Error(`Unrecognized seat range: ${label}`);
  if (result.low < 0 || result.high > 120 || result.low > result.high) throw new Error(`Invalid seat range: ${label}`);
  return result;
}

function arrayValue(input: unknown): unknown[] {
  const result = typeof input === "string" ? JSON.parse(input) : input;
  if (!Array.isArray(result)) throw new Error("Expected an array of market outcomes");
  return result;
}

export function parseEvent(input: unknown): PartyMarket {
  const event = input as Record<string, unknown>;
  if (!event || typeof event.slug !== "string" || !Array.isArray(event.markets)) throw new Error("Invalid market event");
  const id = event.slug.replace(/^israel-election-/, "").replace(/-of-seats$/, "");
  if (!PARTY_META[id]) throw new Error(`Unconfigured party: ${id}`);
  const buckets = event.markets.map((input: unknown) => {
    const market = input as Record<string, unknown>;
    if (typeof market.groupItemTitle !== "string") throw new Error("Missing seat range");
    const outcomes = arrayValue(market.outcomes);
    const yes = outcomes.findIndex(o => typeof o === "string" && o.toLowerCase() === "yes");
    const values = arrayValue(market.outcomePrices);
    const raw = values[yes];
    if (yes < 0 || raw === null || raw === undefined || raw === "" || typeof raw === "boolean") throw new Error("Missing Yes price");
    const price = Number(raw);
    if (!Number.isFinite(price) || price < 0 || price > 1) throw new Error("Invalid Yes price");
    return { label: market.groupItemTitle, ...parseRange(market.groupItemTitle), price, probability: 0 };
  }).sort((a, b) => a.low - b.low);
  let next = 0;
  for (const bucket of buckets) {
    if (bucket.low !== next) throw new Error(`Incomplete or overlapping ranges for ${id}`);
    next = bucket.high + 1;
  }
  if (next !== 121) throw new Error(`Seat ranges do not cover 0–120 for ${id}`);
  const priceSum = buckets.reduce((sum, b) => sum + b.price, 0);
  if (!(priceSum > 0)) throw new Error(`No positive prices for ${id}`);
  for (const bucket of buckets) bucket.probability = bucket.price / priceSum;
  return { id, slug: event.slug, ...PARTY_META[id], buckets, priceSum, volume: Number(event.volume) || 0, updatedAt: typeof event.updatedAt === "string" ? event.updatedAt : null, closed: event.closed === true, rules: typeof event.description === "string" ? event.description : "" };
}

export function effectiveRange(bucket: Bucket, buckets: Bucket[], tailMode: TailMode) {
  if (tailMode === "full" || !bucket.open) return { low: bucket.low, high: bucket.high };
  const bounded = buckets.filter(b => !b.open);
  const neighbor = bucket.open === "lower" ? bounded[0] : bounded.at(-1);
  const width = neighbor ? neighbor.high - neighbor.low + 1 : 1;
  return bucket.open === "lower"
    ? { low: bucket.high < 4 ? 0 : Math.max(0, bucket.high - width + 1), high: bucket.high }
    : { low: bucket.low, high: Math.min(120, bucket.low + width - 1) };
}

export function partyDistribution(party: PartyMarket, tailMode: TailMode): Distribution {
  const pmf = Array(121).fill(0) as number[];
  for (const bucket of party.buckets) {
    const { low, high } = effectiveRange(bucket, party.buckets, tailMode);
    for (let seat = low; seat <= high; seat++) pmf[seat] += bucket.probability / (high - low + 1);
  }
  return pmf;
}

export function convolve(a: Distribution, b: Distribution): Distribution {
  const result = Array(a.length + b.length - 1).fill(0) as number[];
  for (let i = 0; i < a.length; i++) if (a[i]) {
    for (let j = 0; j < b.length; j++) if (b[j]) result[i + j] += a[i] * b[j];
  }
  return result;
}

export interface DependenceModel { id: string; combine: (distributions: Distribution[]) => Distribution }
export const independentModel: DependenceModel = {
  id: "independent-v1",
  combine: distributions => distributions.reduce(convolve, [1]),
};

export function quantile(pmf: Distribution, probability: number): number {
  let cumulative = 0;
  for (let i = 0; i < pmf.length; i++) {
    cumulative += pmf[i];
    if (cumulative + 1e-12 >= probability) return i;
  }
  return pmf.length - 1;
}

export function summarize(pmf: Distribution, target = 61) {
  const mean = pmf.reduce((sum, p, n) => sum + n * p, 0);
  const variance = pmf.reduce((sum, p, n) => sum + (n - mean) ** 2 * p, 0);
  return {
    mean, variance, median: quantile(pmf, 0.5), low: quantile(pmf, 0.05), high: quantile(pmf, 0.95),
    majority: pmf.slice(target).reduce((a, b) => a + b, 0),
    over120: pmf.slice(121).reduce((a, b) => a + b, 0),
  };
}

export function coalitionDistribution(parties: PartyMarket[], selected: string[], tails: TailMode, model: DependenceModel = independentModel) {
  const ids = new Set(selected);
  return model.combine(parties.filter(p => ids.has(p.id)).map(p => partyDistribution(p, tails)));
}

export function sortParties(parties: PartyMarket[]) {
  const order = Object.keys(PARTY_META);
  return [...parties].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
}
