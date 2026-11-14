/**
 * Stock ledger with weighted-average costing (WAC).
 *
 * Every stock change is an append-only movement. A balance is nothing more than a fold over
 * the movements of one (warehouse, variant) pair: qty = Σ movement.qty, and the average cost
 * evolves by the WAC rule below. The database materialises balances for speed; property tests
 * prove the materialised value always equals the fold.
 *
 * Why weighted average and not FIFO:
 *  - It is what Uzbek accountants already use (1C "o'rtacha tannarx"), so reports match theirs.
 *  - Transfers, returns and inventory adjustments need no cost-layer bookkeeping, which keeps
 *    the ledger small enough to prove correct.
 *  - Batches are still tracked for expiry dates (FEFO picking), decoupled from costing.
 */
import { roundCost, roundMoney, roundQty } from './money';

export const MOVEMENT_KINDS = [
  'opening',
  'receipt',
  'sale',
  'sale_return',
  'transfer_out',
  'transfer_in',
  'write_off',
  'adjustment',
  'purchase_return',
] as const;
export type MovementKind = (typeof MOVEMENT_KINDS)[number];

/** Signs each kind may have. Adjustments go both ways. */
export const MOVEMENT_DIRECTION: Record<MovementKind, 'in' | 'out' | 'both'> = {
  opening: 'in',
  receipt: 'in',
  sale_return: 'in',
  transfer_in: 'in',
  sale: 'out',
  transfer_out: 'out',
  write_off: 'out',
  purchase_return: 'out',
  adjustment: 'both',
};

export interface Balance {
  qty: number;
  avgCost: number;
}

export interface MovementInput {
  kind: MovementKind;
  /** Signed quantity in base units: positive = in, negative = out. */
  qty: number;
  /** Unit cost for inbound movements. Outbound movements always leave at the average cost. */
  unitCost?: number;
}

export interface AppliedMovement {
  balance: Balance;
  /** Unit cost the movement was booked at. */
  unitCost: number;
  /** Total cost value of the movement (signed like qty). */
  costValue: number;
}

export type StockErrorCode = 'INSUFFICIENT_STOCK' | 'INVALID_DIRECTION' | 'INVALID_QTY' | 'INVALID_COST';

export class StockError extends Error {
  constructor(
    public readonly code: StockErrorCode,
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'StockError';
  }
}

export const EMPTY_BALANCE: Balance = Object.freeze({ qty: 0, avgCost: 0 });

/**
 * Apply one movement to a balance. Pure: returns the new balance and the cost the movement was
 * booked at (outbound movements leave at the current average cost → this is COGS).
 */
export function applyMovement(balance: Balance, mv: MovementInput, opts: { allowNegative?: boolean } = {}): AppliedMovement {
  const qty = roundQty(mv.qty);
  if (!Number.isFinite(qty) || qty === 0) {
    throw new StockError('INVALID_QTY', 'Quantity must be a non-zero number', { qty: mv.qty });
  }
  const dir = MOVEMENT_DIRECTION[mv.kind];
  if ((dir === 'in' && qty < 0) || (dir === 'out' && qty > 0)) {
    throw new StockError('INVALID_DIRECTION', `Movement ${mv.kind} cannot have quantity ${qty}`, { kind: mv.kind, qty });
  }

  if (qty > 0) {
    const unitCost = roundCost(mv.unitCost ?? balance.avgCost);
    if (!Number.isFinite(unitCost) || unitCost < 0) {
      throw new StockError('INVALID_COST', 'Unit cost must be zero or positive', { unitCost });
    }
    const newQty = roundQty(balance.qty + qty);
    // If stock was empty (or negative), the incoming cost simply becomes the new average.
    const avgCost =
      balance.qty <= 0 || newQty <= 0 ? unitCost : roundCost((balance.qty * balance.avgCost + qty * unitCost) / newQty);
    return { balance: { qty: newQty, avgCost }, unitCost, costValue: roundMoney(qty * unitCost) };
  }

  const newQty = roundQty(balance.qty + qty);
  if (newQty < 0 && !opts.allowNegative) {
    throw new StockError('INSUFFICIENT_STOCK', 'Not enough stock', { available: balance.qty, requested: -qty });
  }
  const unitCost = balance.avgCost;
  return { balance: { qty: newQty, avgCost: balance.avgCost }, unitCost, costValue: roundMoney(qty * unitCost) };
}

export function balanceKey(warehouseId: string, variantId: string): string {
  return `${warehouseId}:${variantId}`;
}

export interface LedgerEntry extends MovementInput {
  warehouseId: string;
  variantId: string;
}

export interface PostedEntry extends LedgerEntry {
  unitCost: number;
  costValue: number;
}

/**
 * In-memory ledger: applies movements in order and keeps materialised balances.
 * The demo seeder uses it to generate 90 days of consistent history quickly; tests use it as an oracle.
 */
export class Ledger {
  readonly balances = new Map<string, Balance>();
  readonly entries: PostedEntry[] = [];

  get(warehouseId: string, variantId: string): Balance {
    return this.balances.get(balanceKey(warehouseId, variantId)) ?? EMPTY_BALANCE;
  }

  post(entry: LedgerEntry): AppliedMovement {
    const key = balanceKey(entry.warehouseId, entry.variantId);
    const applied = applyMovement(this.balances.get(key) ?? EMPTY_BALANCE, entry);
    this.balances.set(key, applied.balance);
    this.entries.push({ ...entry, qty: roundQty(entry.qty), unitCost: applied.unitCost, costValue: applied.costValue });
    return applied;
  }

  /** A transfer is a paired out/in movement booked at the source's average cost. */
  transfer(fromWarehouseId: string, toWarehouseId: string, variantId: string, qty: number): number {
    const out = this.post({ kind: 'transfer_out', warehouseId: fromWarehouseId, variantId, qty: -qty });
    this.post({ kind: 'transfer_in', warehouseId: toWarehouseId, variantId, qty, unitCost: out.unitCost });
    return out.unitCost;
  }
}

/** Recompute balances from scratch by folding the movements — the source of truth. */
export function foldLedger(entries: Iterable<LedgerEntry>): Map<string, Balance> {
  const out = new Map<string, Balance>();
  for (const e of entries) {
    const key = balanceKey(e.warehouseId, e.variantId);
    out.set(key, applyMovement(out.get(key) ?? EMPTY_BALANCE, e, { allowNegative: true }).balance);
  }
  return out;
}

/** Quantity-only fold (what the database drift check compares against). */
export function sumQuantities(entries: Iterable<{ warehouseId: string; variantId: string; qty: number }>): Map<string, number> {
  const out = new Map<string, number>();
  for (const e of entries) {
    const key = balanceKey(e.warehouseId, e.variantId);
    out.set(key, roundQty((out.get(key) ?? 0) + e.qty));
  }
  return out;
}
