// Loyalty Rewards data layer — program settings, per-customer point
// balances, and per-shop aggregate stats. Cloudflare KV-backed (bind a
// namespace named LOYALTY in wrangler.toml / via the AppApprove
// dashboard). When unbound (local dev / preview without remote bindings)
// it falls back to an in-memory map so the app still boots — mirroring
// app/lib/session-storage.server.ts. Persisted data is lost on Worker
// restart in that fallback mode, so bind LOYALTY in production.

import type { Env } from "../../load-context";

export interface LoyaltySettings {
  /** Master switch — when false, no points are earned on new orders. */
  enabled: boolean;
  /** Customer-facing program name (shown on the rewards page). */
  programName: string;
  /** Points awarded per 1 unit of the shop's currency spent. */
  pointsPerDollar: number;
  /** Points required to redeem 1 unit of the shop's currency at checkout. */
  redeemPointsPerCurrencyUnit: number;
  /** Minimum balance before a customer may redeem. */
  minRedeemPoints: number;
  /** Last-saved timestamp (ms since epoch); 0 means never saved. */
  updatedAt: number;
}

export interface LoyaltyStats {
  /** Distinct customers who have earned points at least once. */
  members: number;
  totalPointsIssued: number;
  totalPointsRedeemed: number;
  updatedAt: number;
}

export const DEFAULT_SETTINGS: LoyaltySettings = {
  enabled: true,
  programName: "Loyalty Rewards",
  pointsPerDollar: 1,
  redeemPointsPerCurrencyUnit: 100,
  minRedeemPoints: 200,
  updatedAt: 0,
};

export const EMPTY_STATS: LoyaltyStats = {
  members: 0,
  totalPointsIssued: 0,
  totalPointsRedeemed: 0,
  updatedAt: 0,
};

const SETTINGS_PREFIX = "loyalty:settings:";
const BALANCE_PREFIX = "loyalty:balance:";
const STATS_PREFIX = "loyalty:stats:";

// In-memory fallback stores (one per record kind), used only when the
// LOYALTY KV namespace is not bound.
const memSettings = new Map<string, string>();
const memBalances = new Map<string, string>();
const memStats = new Map<string, string>();

function kv(env: Env): KVNamespace | null {
  return (env.LOYALTY as KVNamespace | undefined) ?? null;
}

async function kvGet(
  env: Env,
  mem: Map<string, string>,
  key: string,
): Promise<string | null> {
  const ns = kv(env);
  if (ns) return ns.get(key);
  return mem.get(key) ?? null;
}

async function kvPut(
  env: Env,
  mem: Map<string, string>,
  key: string,
  value: string,
): Promise<void> {
  const ns = kv(env);
  if (ns) {
    await ns.put(key, value);
    return;
  }
  mem.set(key, value);
}

// ─── Settings ──────────────────────────────────────────────────────

export async function loadSettings(
  env: Env,
  shop: string,
): Promise<LoyaltySettings> {
  const raw = await kvGet(env, memSettings, SETTINGS_PREFIX + shop);
  if (!raw) return { ...DEFAULT_SETTINGS };
  try {
    const parsed = JSON.parse(raw) as Partial<LoyaltySettings>;
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export async function saveSettings(
  env: Env,
  shop: string,
  settings: Partial<LoyaltySettings>,
): Promise<LoyaltySettings> {
  const merged: LoyaltySettings = {
    ...DEFAULT_SETTINGS,
    ...settings,
    updatedAt: Date.now(),
  };
  await kvPut(env, memSettings, SETTINGS_PREFIX + shop, JSON.stringify(merged));
  return merged;
}

// ─── Balances ──────────────────────────────────────────────────────

function balanceKey(shop: string, customerId: string): string {
  return BALANCE_PREFIX + shop + ":" + customerId;
}

export async function getBalance(
  env: Env,
  shop: string,
  customerId: string,
): Promise<number> {
  const raw = await kvGet(env, memBalances, balanceKey(shop, customerId));
  const n = raw ? Number(raw) : 0;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

async function setBalance(
  env: Env,
  shop: string,
  customerId: string,
  points: number,
): Promise<void> {
  await kvPut(env, memBalances, balanceKey(shop, customerId), String(points));
}

// ─── Stats ─────────────────────────────────────────────────────────

export async function loadStats(env: Env, shop: string): Promise<LoyaltyStats> {
  const raw = await kvGet(env, memStats, STATS_PREFIX + shop);
  if (!raw) return { ...EMPTY_STATS };
  try {
    return { ...EMPTY_STATS, ...(JSON.parse(raw) as Partial<LoyaltyStats>) };
  } catch {
    return { ...EMPTY_STATS };
  }
}

async function saveStats(
  env: Env,
  shop: string,
  stats: LoyaltyStats,
): Promise<void> {
  await kvPut(env, memStats, STATS_PREFIX + shop, JSON.stringify(stats));
}

// Credit a customer's balance and roll the per-shop aggregate stats
// forward. The stats read-modify-write is best-effort (KV is eventually
// consistent — concurrent orders for the same shop may briefly under-count,
// matching the "close enough for accounting" trade-off in trial.server.ts).
export async function earnPoints(
  env: Env,
  shop: string,
  customerId: string,
  points: number,
): Promise<{ balance: number; awarded: number }> {
  const prev = await getBalance(env, shop, customerId);
  if (points <= 0) return { balance: prev, awarded: 0 };
  const next = prev + Math.floor(points);
  await setBalance(env, shop, customerId, next);
  const stats = await loadStats(env, shop);
  stats.totalPointsIssued += Math.floor(points);
  if (prev === 0) stats.members += 1;
  stats.updatedAt = Date.now();
  await saveStats(env, shop, stats);
  return { balance: next, awarded: Math.floor(points) };
}

// ─── Pure helpers (no I/O) ─────────────────────────────────────────

// Points earned for an order, given its money amount (in the shop's
// currency). Returns 0 when the program is disabled or the amount is
// non-positive. Floored so customers never see fractional points.
export function computePointsForOrder(
  settings: LoyaltySettings,
  amount: number,
): number {
  if (!settings.enabled) return 0;
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  return Math.floor(amount * settings.pointsPerDollar);
}

// Monetary value (in the shop's currency) that a point balance can be
// redeemed for at checkout. Floored to whole cents.
export function pointsToCurrencyValue(
  settings: LoyaltySettings,
  points: number,
): number {
  if (settings.redeemPointsPerCurrencyUnit <= 0) return 0;
  if (!Number.isFinite(points) || points <= 0) return 0;
  return Math.floor((points / settings.redeemPointsPerCurrencyUnit) * 100) / 100;
}
