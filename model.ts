// The radar model. One sealed snapshot in, one ranked board plus compact dashboard data out.
//
// The board ranks only protocols whose DefiLlama record names no token and which are not a
// wrapped, staked or bridged product of a token that already trades. That keeps the board about
// protocols still waiting on a launch of their own. Live-token protocols and set-aside products
// are shown beside the board, never mixed into its ranks.
//
//   base    = tvl_usd x 0.32
//   growth  = clamp(change_7d or 0, -60, 150) / 100 x 0.60 + 1
//   tenure  = 0.80 + min(age_days or 365, 1460) / 1460 x 0.50
//   implied = max(1, round(base x growth x tenure))
//
// Only snapshot fields feed the arithmetic. No protocol name is special-cased.

export interface Protocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Protocol[];
  watchlist: string[];
}

export interface Model {
  b: number;
  gw: number;
  gf: number;
  gc: number;
  af: number;
  ar: number;
  ad: number;
  ua: number;
}

export const MODEL: Model = { b: 0.32, gw: 0.6, gf: -60, gc: 150, af: 0.8, ar: 0.5, ad: 1460, ua: 365 };
export const MODEL_VERSION = 'tenure-weighted-2';
export const LIVE_ROWS = 24;
export const ASIDE_ROWS = 24;

export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: null;
  listed_at: string | null;
  gecko_id: null;
  symbol: null;
  token_status: 'no-token-on-record';
  age_days: number | null;
  implied_value_usd: number;
  model: {
    base_multiple: number;
    growth_pct: number;
    growth_multiplier: number;
    tenure_multiplier: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number;
  change_7d: number | null;
  symbol: string | null;
}

export interface AsideRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  reason: string;
}

export interface Built {
  asOf: string;
  watchlistSize: number;
  floorUsd: number;
  board: BoardRow[];
  live: LiveRow[];
  aside: AsideRow[];
  cats: string[];
  chains: string[];
}

export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY = 86_400_000;
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;
const PRODUCT_CATEGORY = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

const round4 = (n: number): number => Math.round(n * 10_000) / 10_000;

/** Whole days from the snapshot date to DefiLlama's first-tracked day. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const end = Date.parse(`${asOf}T00:00:00Z`);
  const start = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(end) || !Number.isFinite(start)) return null;
  return Math.max(0, Math.floor((end - start) / DAY));
}

/** The three multipliers and the implied value for one protocol. */
export function impliedValue(p: Protocol, asOf: string, model: Model = MODEL) {
  const age = ageDays(asOf, p.listed_at);
  const raw = typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : 0;
  const growthPct = Math.min(model.gc, Math.max(model.gf, raw));
  const growthMultiplier = 1 + (growthPct / 100) * model.gw;
  const ageForModel = age ?? model.ua;
  const tenureMultiplier = model.af + (Math.min(Math.max(ageForModel, 0), model.ad) / model.ad) * model.ar;
  const implied = Math.max(1, Math.round(p.tvl_usd * model.b * growthMultiplier * tenureMultiplier));
  return { implied, growthPct, growthMultiplier, tenureMultiplier, age };
}

/** A record with no token fields carries no token on record, not proof that none exists. */
export function hasNoTokenOnRecord(p: Protocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** Why a no-token record is set aside, or null when it can be ranked. */
export function setAsideReason(p: Protocol): string | null {
  if (VERSIONED.test(p.name)) return 'versioned pool of another protocol';
  if (PRODUCT_CATEGORY.has(p.category ?? '')) return 'bridge, staked or exchange product';
  if (WRAPPED_WORD.test(p.name)) return 'wrapped or staked product';
  if (EXCHANGE.test(p.name)) return 'exchange product';
  return null;
}

/** A capital band, gas estimate and hold period derived only from size and age. */
function planFor(p: Protocol, age: number | null, chain: string) {
  const tvl = p.tvl_usd;
  const capital = tvl >= 2e9 ? 400 : tvl >= 5e8 ? 250 : tvl >= 1e8 ? 150 : tvl >= 2e7 ? 100 : 60;
  const gas = capital >= 250 ? 12 : capital >= 150 ? 8 : 5;
  const hold = age === null ? 30 : age < 180 ? 60 : age < 365 ? 45 : 30;
  const category = (p.category ?? '').toLowerCase();
  let action: string;
  if (/risk curator|capital allocator|allocator|vault|yield aggregator|asset management/.test(category)) {
    action = `Deposit $${capital} of USDC into one published ${p.name} vault on ${chain}, record the entry share price and keep the receipt.`;
  } else if (/lend|cdp|collateral/.test(category)) {
    action = `Supply $${capital} of USDC to ${p.name} on ${chain}; if borrowing is needed, keep the loan under 30 percent of the deposit so the position stays simple.`;
  } else if (/dexs?|liquidity|farm/.test(category)) {
    action = `Provide about $${capital} of two-sided liquidity to the main ${p.name} pool on ${chain} and record both assets, the price range and the pool shares.`;
  } else if (/prediction/.test(category)) {
    action = `Fund $${capital} on ${chain} and take one small position through ${p.name}; write down the market, side and expiry before you enter.`;
  } else if (/rwa|bond/.test(category)) {
    action = `Mint or buy $${capital} of the yield asset published by ${p.name} on ${chain} and hold it through one full distribution period.`;
  } else if (/perpetual|derivative|options/.test(category)) {
    action = `Deposit $${capital} of USDC as margin on ${chain} and open one small hedged position through ${p.name}; record the liquidation price.`;
  } else if (/staking|restaking/.test(category)) {
    action = `Stake about $${capital} of the chain's native asset through ${p.name} on ${chain} and keep the staking receipt in the same wallet.`;
  } else if (/insurance|cover/.test(category)) {
    action = `Buy about $${capital} of cover from ${p.name} on ${chain} and keep the policy number and expiry in the farm log.`;
  } else {
    action = `Deposit $${capital} of USDC into ${p.name} on ${chain} and keep the position open; record the contract address from the protocol's own page.`;
  }
  return { capital, gas, hold, action };
}

/** Six concrete actions with an explicit cost and duration for every ranked row. */
export function farmSteps(p: Protocol, age: number | null): string[] {
  const chain = p.chains.length > 0 ? p.chains[0]! : 'its main chain';
  const { capital, gas, hold, action } = planFor(p, age, chain);
  const steps: Array<[string, string, string]> = [
    [
      `Open a dedicated wallet for ${p.name}, fund it with about $${gas} of gas and verify the chain and contract address on the protocol's own page.`,
      `about $${gas} of gas`,
      '5 minutes',
    ],
    [action, `$${capital} of capital and about $${gas} of gas`, '15 minutes to set up'],
    [
      `Make one qualifying on-chain action each week, such as a deposit, a borrow, a swap or a vote, and save the transaction hash.`,
      'about $2 of gas each week',
      '10 minutes each week',
    ],
    [
      `Keep the position open for at least ${hold} days so the activity appears in more than one weekly snapshot; do not churn it on the last day.`,
      `the $${capital} stays in the position`,
      `${hold} days`,
    ],
    [
      `Check ${p.name}'s own rewards or points page weekly and claim only from a link the protocol publishes; never pay an unsolicited claim fee.`,
      'no fee to check',
      '10 minutes each week',
    ],
    [
      `Write the wallet, dates, contract and every transaction hash in a farm log, then set an exit date and unwind if the protocol's own terms change.`,
      'nothing beyond the log',
      '5 minutes at entry and exit',
    ],
  ];
  return steps.map(([text, cost, time]) => `${text} Cost: ${cost}. Time: ${time}.`);
}

/** Sort by value, then slug, so the rank never depends on input order. */
function compareScored(a: { implied: number; p: Protocol }, b: { implied: number; p: Protocol }): number {
  if (a.implied !== b.implied) return b.implied - a.implied;
  return a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0;
}

/** Build the ranked board, the live-token comparables, the set-aside list and compact UI data. */
export function buildRadar(snapshot: Snapshot): Built {
  const ranked = snapshot.protocols.filter((p) => hasNoTokenOnRecord(p) && setAsideReason(p) === null);
  const scored = ranked.map((p) => ({ p, ...impliedValue(p, snapshot.as_of) })).sort(compareScored);
  const board: BoardRow[] = scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: null,
    listed_at: s.p.listed_at,
    gecko_id: null,
    symbol: null,
    token_status: 'no-token-on-record',
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      base_multiple: MODEL.b,
      growth_pct: round4(s.growthPct),
      growth_multiplier: round4(s.growthMultiplier),
      tenure_multiplier: round4(s.tenureMultiplier),
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age),
  }));

  const live: LiveRow[] = snapshot.protocols
    .filter((p) => !hasNoTokenOnRecord(p))
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd ?? 0,
      change_7d: p.change_7d,
      symbol: p.symbol,
    }));

  const aside: AsideRow[] = snapshot.protocols
    .filter((p) => hasNoTokenOnRecord(p) && setAsideReason(p) !== null)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, ASIDE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      reason: setAsideReason(p) ?? 'set aside',
    }));

  const seenCats = new Set<string>();
  const seenChains = new Set<string>();
  for (const p of [...ranked, ...live, ...aside]) {
    if (p.category !== null) seenCats.add(p.category);
    for (const c of p.chains) seenChains.add(c);
  }
  const cats = [...seenCats].sort();
  const chains = [...seenChains].sort();
  return {
    asOf: snapshot.as_of,
    watchlistSize: snapshot.watchlist.length,
    floorUsd: snapshot.floor_usd,
    board,
    live,
    aside,
    cats,
    chains,
  };
}

/** A small deterministic guard that mirrors the gate's own board checks. */
export function selfCheck(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `board has ${board.length} rows`;
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  const seen = new Set<string>();
  let last = Number.POSITIVE_INFINITY;
  for (let i = 0; i < board.length; i++) {
    const r = board[i]!;
    if (r.rank !== i + 1) return `rank ${r.rank} at position ${i + 1}`;
    if (seen.has(r.slug)) return `duplicate slug ${r.slug}`;
    seen.add(r.slug);
    if (!known.has(r.slug)) return `unknown slug ${r.slug}`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `bad implied value for ${r.slug}`;
    if (r.implied_value_usd > last) return `value rises at rank ${r.rank}`;
    last = r.implied_value_usd;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `bad farm steps for ${r.slug}`;
    for (const step of r.farm_steps) {
      if (step.trim().length < 20 || step.trim().length > 600) return `bad farm step for ${r.slug}`;
    }
  }
  const missing = snapshot.watchlist.filter((slug) => !seen.has(slug));
  if (missing.length > 0) return `watchlist slugs missing: ${missing.slice(0, 3).join(', ')}`;
  return null;
}

/** A strict parse: the program refuses a snapshot it cannot score. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot is not an object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('bad as_of');
  if (typeof o.source !== 'string') throw new SnapshotError('bad source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('bad floor_usd');
  if (!Array.isArray(o.protocols) || !Array.isArray(o.watchlist)) throw new SnapshotError('missing protocols or watchlist');
  const protocols: Protocol[] = o.protocols.map((item) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) throw new SnapshotError('bad protocol');
    const p = item as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string') throw new SnapshotError('protocol needs slug and name');
    if (p.category !== null && typeof p.category !== 'string') throw new SnapshotError('bad category');
    if (!Array.isArray(p.chains) || p.chains.some((c) => typeof c !== 'string')) throw new SnapshotError('bad chains');
    if (typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) throw new SnapshotError('bad tvl_usd');
    if (p.change_7d !== null && typeof p.change_7d !== 'number') throw new SnapshotError('bad change_7d');
    if (p.mcap_usd !== null && typeof p.mcap_usd !== 'number') throw new SnapshotError('bad mcap_usd');
    if (p.listed_at !== null && typeof p.listed_at !== 'string') throw new SnapshotError('bad listed_at');
    if (p.gecko_id !== null && typeof p.gecko_id !== 'string') throw new SnapshotError('bad gecko_id');
    if (p.symbol !== null && typeof p.symbol !== 'string') throw new SnapshotError('bad symbol');
    return p as unknown as Protocol;
  });
  if (o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('bad watchlist');
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/**
 * The dashboard's data as a compact array table. The page reconstructs rows with the same
 * category and chain indexes, and recomputes implied value from the same model constants.
 */
export function dataScript(built: Built): string {
  const catIndex = new Map(built.cats.map((c, i) => [c, i]));
  const chainIndex = new Map(built.chains.map((c, i) => [c, i]));
  const ci = (category: string | null): number => (category === null ? -1 : (catIndex.get(category) ?? -1));
  const ch = (chains: string[]): number[] => chains.map((c) => chainIndex.get(c) ?? 0);
  const data = {
    as: built.asOf,
    fl: built.floorUsd,
    mv: MODEL_VERSION,
    m: MODEL,
    w: built.watchlistSize,
    n: built.board.length,
    l: built.live.length,
    x: built.aside.length,
    cats: built.cats,
    chains: built.chains,
    rows: built.board.map((r) => [r.slug, r.name, ci(r.category), ch(r.chains), r.tvl_usd, r.change_7d, r.age_days, r.implied_value_usd]),
    live: built.live.map((r) => [r.slug, r.name, ci(r.category), ch(r.chains), r.tvl_usd, r.mcap_usd, r.change_7d, r.symbol]),
    aside: built.aside.map((r) => [r.slug, r.name, ci(r.category), ch(r.chains), r.tvl_usd, r.reason]),
  };
  return `window.RADAR=${JSON.stringify(data)};\n`;
}
