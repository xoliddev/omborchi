/**
 * Initial schema. Plain SQL kept in a TS module so the exact same migration runs on
 * PostgreSQL 16 (server, via node-postgres) and on PGlite (Postgres in WASM, in the demo).
 */
export default /* sql */ `
-- ── Tenancy & auth ───────────────────────────────────────────────────────────
CREATE TABLE orgs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  currency text NOT NULL DEFAULT 'UZS',
  costing_method text NOT NULL DEFAULT 'wac' CHECK (costing_method = 'wac'),
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  name text NOT NULL,
  password_hash text,
  locale text NOT NULL DEFAULT 'uz' CHECK (locale IN ('uz','ru','en')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_key ON users (lower(email));

CREATE TABLE memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner','manager','cashier','storekeeper')),
  all_warehouses boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, user_id)
);

CREATE TABLE sessions (
  id text PRIMARY KEY,               -- sha256 of the opaque cookie token
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  org_id uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX sessions_user_idx ON sessions (user_id);

CREATE TABLE warehouses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  name text NOT NULL,
  code text NOT NULL,
  kind text NOT NULL DEFAULT 'store' CHECK (kind IN ('store','warehouse')),
  address text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, code)
);

CREATE TABLE membership_warehouses (
  membership_id uuid NOT NULL REFERENCES memberships(id) ON DELETE CASCADE,
  warehouse_id uuid NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  PRIMARY KEY (membership_id, warehouse_id)
);

-- ── Catalog ──────────────────────────────────────────────────────────────────
CREATE TABLE units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  allow_fraction boolean NOT NULL DEFAULT false,
  UNIQUE (org_id, code)
);

CREATE TABLE categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  parent_id uuid REFERENCES categories(id) ON DELETE RESTRICT,
  name text NOT NULL,
  sort integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (parent_id IS NULL OR parent_id <> id)
);
CREATE INDEX categories_parent_idx ON categories (org_id, parent_id);

-- Nested categories of any depth, but never a cycle.
CREATE FUNCTION categories_no_cycle() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.parent_id IS NOT NULL AND EXISTS (
    WITH RECURSIVE up(id, parent_id) AS (
      SELECT id, parent_id FROM categories WHERE id = NEW.parent_id
      UNION ALL
      SELECT c.id, c.parent_id FROM categories c JOIN up ON c.id = up.parent_id
    )
    SELECT 1 FROM up WHERE id = NEW.id
  ) THEN
    RAISE EXCEPTION 'category cycle' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER categories_no_cycle BEFORE INSERT OR UPDATE OF parent_id ON categories
  FOR EACH ROW EXECUTE FUNCTION categories_no_cycle();

CREATE TABLE products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  category_id uuid REFERENCES categories(id) ON DELETE SET NULL,
  name text NOT NULL,
  description text,
  base_unit_id uuid NOT NULL REFERENCES units(id),
  track_expiry boolean NOT NULL DEFAULT false,
  min_stock numeric(14,3) NOT NULL DEFAULT 0 CHECK (min_stock >= 0),
  image_url text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX products_org_idx ON products (org_id, category_id);

-- Extra units of measure for a product: "quti" = 12 × "dona".
CREATE TABLE product_units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  unit_id uuid NOT NULL REFERENCES units(id),
  factor numeric(14,3) NOT NULL CHECK (factor > 0),
  barcode text,
  UNIQUE (product_id, unit_id)
);

CREATE TABLE variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT '',
  sku text NOT NULL,
  barcode text,
  barcode_type text CHECK (barcode_type IN ('ean13','code128')),
  last_cost numeric(18,4) NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, sku)
);
CREATE UNIQUE INDEX variants_barcode_key ON variants (org_id, barcode) WHERE barcode IS NOT NULL;
CREATE INDEX variants_product_idx ON variants (product_id);

CREATE TABLE price_lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  UNIQUE (org_id, code)
);

CREATE TABLE prices (
  price_list_id uuid NOT NULL REFERENCES price_lists(id) ON DELETE CASCADE,
  variant_id uuid NOT NULL REFERENCES variants(id) ON DELETE CASCADE,
  price numeric(18,2) NOT NULL CHECK (price >= 0),
  PRIMARY KEY (price_list_id, variant_id)
);

-- ── Stock: append-only ledger + materialised balances ───────────────────────
CREATE TABLE batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  variant_id uuid NOT NULL REFERENCES variants(id) ON DELETE CASCADE,
  code text NOT NULL,
  expires_at date,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (variant_id, code)
);

CREATE TABLE stock_balances (
  org_id uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  warehouse_id uuid NOT NULL REFERENCES warehouses(id),
  variant_id uuid NOT NULL REFERENCES variants(id),
  qty numeric(14,3) NOT NULL DEFAULT 0,
  avg_cost numeric(18,4) NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (warehouse_id, variant_id),
  CONSTRAINT stock_never_negative CHECK (qty >= 0)
);
CREATE INDEX stock_balances_org_idx ON stock_balances (org_id, variant_id);

CREATE TABLE batch_balances (
  warehouse_id uuid NOT NULL REFERENCES warehouses(id),
  batch_id uuid NOT NULL REFERENCES batches(id),
  qty numeric(14,3) NOT NULL DEFAULT 0,
  PRIMARY KEY (warehouse_id, batch_id),
  CONSTRAINT batch_never_negative CHECK (qty >= 0)
);

CREATE TABLE stock_movements (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  warehouse_id uuid NOT NULL REFERENCES warehouses(id),
  variant_id uuid NOT NULL REFERENCES variants(id),
  batch_id uuid REFERENCES batches(id),
  kind text NOT NULL,
  qty numeric(14,3) NOT NULL CHECK (qty <> 0),
  unit_cost numeric(18,4) NOT NULL CHECK (unit_cost >= 0),
  cost_value numeric(18,2) NOT NULL,
  doc_type text NOT NULL,
  doc_id uuid,
  user_id uuid,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT movement_direction CHECK (
    (kind IN ('opening','receipt','sale_return','transfer_in') AND qty > 0) OR
    (kind IN ('sale','transfer_out','write_off','purchase_return') AND qty < 0) OR
    (kind = 'adjustment')
  )
);
CREATE INDEX stock_movements_balance_idx ON stock_movements (warehouse_id, variant_id, id);
CREATE INDEX stock_movements_org_time_idx ON stock_movements (org_id, created_at);
CREATE INDEX stock_movements_doc_idx ON stock_movements (doc_type, doc_id);

-- The ledger is append-only: corrections are new movements, never edits.
CREATE FUNCTION forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = 'restrict_violation';
END $$;
CREATE TRIGGER stock_movements_append_only BEFORE UPDATE OR DELETE ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER stock_movements_no_truncate BEFORE TRUNCATE ON stock_movements
  FOR EACH STATEMENT EXECUTE FUNCTION forbid_mutation();

-- Quantities are materialised by the database itself, in the same transaction as the movement.
-- The CHECK on stock_balances turns any oversell into an error, even under concurrency
-- (the second writer blocks on the row lock and then sees the decremented quantity).
CREATE FUNCTION apply_stock_movement() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- UPDATE first: CHECK constraints are evaluated on the proposed row before ON CONFLICT
  -- arbitration, so an upsert of a negative delta would fail even when the row exists.
  UPDATE stock_balances SET qty = qty + NEW.qty, updated_at = greatest(updated_at, NEW.created_at)
  WHERE warehouse_id = NEW.warehouse_id AND variant_id = NEW.variant_id;
  IF NOT FOUND THEN
    INSERT INTO stock_balances (org_id, warehouse_id, variant_id, qty, avg_cost, updated_at)
    VALUES (NEW.org_id, NEW.warehouse_id, NEW.variant_id, 0, NEW.unit_cost, NEW.created_at)
    ON CONFLICT (warehouse_id, variant_id) DO NOTHING;
    UPDATE stock_balances SET qty = qty + NEW.qty, updated_at = greatest(updated_at, NEW.created_at)
    WHERE warehouse_id = NEW.warehouse_id AND variant_id = NEW.variant_id;
  END IF;
  IF NEW.batch_id IS NOT NULL THEN
    UPDATE batch_balances SET qty = qty + NEW.qty WHERE warehouse_id = NEW.warehouse_id AND batch_id = NEW.batch_id;
    IF NOT FOUND THEN
      INSERT INTO batch_balances (warehouse_id, batch_id, qty) VALUES (NEW.warehouse_id, NEW.batch_id, 0)
      ON CONFLICT (warehouse_id, batch_id) DO NOTHING;
      UPDATE batch_balances SET qty = qty + NEW.qty WHERE warehouse_id = NEW.warehouse_id AND batch_id = NEW.batch_id;
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER stock_movements_apply AFTER INSERT ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION apply_stock_movement();

-- Any row here means the materialised balance and the ledger disagree. Tests assert it is empty.
CREATE VIEW stock_drift AS
  SELECT warehouse_id, variant_id, coalesce(b.qty, 0) AS balance_qty, coalesce(m.qty, 0) AS ledger_qty
  FROM stock_balances b
  FULL JOIN (SELECT warehouse_id, variant_id, sum(qty) AS qty FROM stock_movements GROUP BY 1, 2) m
  USING (warehouse_id, variant_id)
  WHERE coalesce(b.qty, 0) <> coalesce(m.qty, 0);

-- ── Parties & debts ──────────────────────────────────────────────────────────
CREATE TABLE suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  name text NOT NULL,
  phone text,
  contact text,
  inn text,
  address text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  name text NOT NULL,
  phone text,
  note text,
  credit_limit numeric(18,2),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- One ledger for both receivables (customers) and payables (suppliers).
CREATE TABLE debt_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  party_type text NOT NULL CHECK (party_type IN ('customer','supplier')),
  party_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('charge','payment')),
  amount numeric(18,2) NOT NULL CHECK (amount > 0),
  due_date date,
  method text,
  doc_type text,
  doc_id uuid,
  note text,
  user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX debt_entries_party_idx ON debt_entries (org_id, party_type, party_id, created_at);
CREATE TRIGGER debt_entries_append_only BEFORE UPDATE OR DELETE ON debt_entries
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- ── Documents ────────────────────────────────────────────────────────────────
CREATE TABLE doc_counters (
  org_id uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  kind text NOT NULL,
  last integer NOT NULL,
  PRIMARY KEY (org_id, kind)
);

CREATE TABLE purchase_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  number text NOT NULL,
  supplier_id uuid NOT NULL REFERENCES suppliers(id),
  warehouse_id uuid NOT NULL REFERENCES warehouses(id),
  status text NOT NULL DEFAULT 'ordered' CHECK (status IN ('draft','ordered','partial','received','cancelled')),
  expected_at date,
  note text,
  total numeric(18,2) NOT NULL DEFAULT 0,
  user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, number)
);

CREATE TABLE purchase_order_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  po_id uuid NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  variant_id uuid NOT NULL REFERENCES variants(id),
  qty_ordered numeric(14,3) NOT NULL CHECK (qty_ordered > 0),
  qty_received numeric(14,3) NOT NULL DEFAULT 0 CHECK (qty_received >= 0),
  unit_cost numeric(18,4) NOT NULL CHECK (unit_cost >= 0),
  CHECK (qty_received <= qty_ordered)
);

CREATE TABLE goods_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  number text NOT NULL,
  po_id uuid REFERENCES purchase_orders(id),
  supplier_id uuid NOT NULL REFERENCES suppliers(id),
  warehouse_id uuid NOT NULL REFERENCES warehouses(id),
  total numeric(18,2) NOT NULL,
  paid numeric(18,2) NOT NULL DEFAULT 0,
  due_date date,
  note text,
  user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, number)
);

CREATE TABLE goods_receipt_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_id uuid NOT NULL REFERENCES goods_receipts(id) ON DELETE CASCADE,
  po_line_id uuid REFERENCES purchase_order_lines(id),
  variant_id uuid NOT NULL REFERENCES variants(id),
  batch_id uuid REFERENCES batches(id),
  qty numeric(14,3) NOT NULL CHECK (qty > 0),
  unit_cost numeric(18,4) NOT NULL CHECK (unit_cost >= 0)
);

CREATE TABLE shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  warehouse_id uuid NOT NULL REFERENCES warehouses(id),
  user_id uuid NOT NULL REFERENCES users(id),
  number text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  opening_cash numeric(18,2) NOT NULL DEFAULT 0,
  counted_cash numeric(18,2),
  expected_cash numeric(18,2),
  note text,
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz
);
CREATE UNIQUE INDEX shifts_one_open ON shifts (warehouse_id, user_id) WHERE status = 'open';

CREATE TABLE sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  number text NOT NULL,
  warehouse_id uuid NOT NULL REFERENCES warehouses(id),
  shift_id uuid REFERENCES shifts(id),
  user_id uuid REFERENCES users(id),
  customer_id uuid REFERENCES customers(id),
  price_list_id uuid REFERENCES price_lists(id),
  subtotal numeric(18,2) NOT NULL,
  discount_total numeric(18,2) NOT NULL DEFAULT 0,
  total numeric(18,2) NOT NULL,
  cost_total numeric(18,2) NOT NULL DEFAULT 0,
  paid numeric(18,2) NOT NULL DEFAULT 0,
  change numeric(18,2) NOT NULL DEFAULT 0,
  debt numeric(18,2) NOT NULL DEFAULT 0,
  due_date date,
  returned_total numeric(18,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'completed' CHECK (status IN ('completed','partially_returned','returned')),
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, number)
);
CREATE INDEX sales_org_time_idx ON sales (org_id, created_at);
CREATE INDEX sales_shift_idx ON sales (shift_id);

CREATE TABLE sale_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id uuid NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  variant_id uuid NOT NULL REFERENCES variants(id),
  unit_code text NOT NULL,
  unit_factor numeric(14,3) NOT NULL DEFAULT 1,
  qty numeric(14,3) NOT NULL CHECK (qty > 0),
  base_qty numeric(14,3) NOT NULL CHECK (base_qty > 0),
  unit_price numeric(18,2) NOT NULL,
  discount numeric(18,2) NOT NULL DEFAULT 0,
  total numeric(18,2) NOT NULL,
  cost_total numeric(18,2) NOT NULL,
  returned_qty numeric(14,3) NOT NULL DEFAULT 0 CHECK (returned_qty >= 0 AND returned_qty <= base_qty)
);
CREATE INDEX sale_lines_sale_idx ON sale_lines (sale_id);
CREATE INDEX sale_lines_variant_idx ON sale_lines (variant_id);

CREATE TABLE sale_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id uuid NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  method text NOT NULL CHECK (method IN ('cash','card','payme','click','uzum')),
  amount numeric(18,2) NOT NULL CHECK (amount > 0),
  provider_ref text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sale_payments_sale_idx ON sale_payments (sale_id);

CREATE TABLE sale_returns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  number text NOT NULL,
  sale_id uuid NOT NULL REFERENCES sales(id),
  warehouse_id uuid NOT NULL REFERENCES warehouses(id),
  shift_id uuid REFERENCES shifts(id),
  total numeric(18,2) NOT NULL,
  cost_total numeric(18,2) NOT NULL,
  refund_method text NOT NULL CHECK (refund_method IN ('cash','card','debt')),
  reason text,
  user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, number)
);

CREATE TABLE sale_return_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  return_id uuid NOT NULL REFERENCES sale_returns(id) ON DELETE CASCADE,
  sale_line_id uuid NOT NULL REFERENCES sale_lines(id),
  variant_id uuid NOT NULL REFERENCES variants(id),
  base_qty numeric(14,3) NOT NULL CHECK (base_qty > 0),
  amount numeric(18,2) NOT NULL,
  cost_total numeric(18,2) NOT NULL
);

CREATE TABLE transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  number text NOT NULL,
  from_warehouse_id uuid NOT NULL REFERENCES warehouses(id),
  to_warehouse_id uuid NOT NULL REFERENCES warehouses(id),
  note text,
  user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (from_warehouse_id <> to_warehouse_id),
  UNIQUE (org_id, number)
);

CREATE TABLE transfer_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id uuid NOT NULL REFERENCES transfers(id) ON DELETE CASCADE,
  variant_id uuid NOT NULL REFERENCES variants(id),
  qty numeric(14,3) NOT NULL CHECK (qty > 0),
  unit_cost numeric(18,4) NOT NULL
);

CREATE TABLE write_offs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  number text NOT NULL,
  warehouse_id uuid NOT NULL REFERENCES warehouses(id),
  reason text NOT NULL CHECK (reason IN ('damaged','expired','lost','internal_use','other')),
  note text,
  total_cost numeric(18,2) NOT NULL DEFAULT 0,
  user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, number)
);

CREATE TABLE write_off_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  write_off_id uuid NOT NULL REFERENCES write_offs(id) ON DELETE CASCADE,
  variant_id uuid NOT NULL REFERENCES variants(id),
  batch_id uuid REFERENCES batches(id),
  qty numeric(14,3) NOT NULL CHECK (qty > 0),
  unit_cost numeric(18,4) NOT NULL
);

CREATE TABLE inventory_counts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  number text NOT NULL,
  warehouse_id uuid NOT NULL REFERENCES warehouses(id),
  category_id uuid REFERENCES categories(id),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','applied','cancelled')),
  note text,
  user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  applied_at timestamptz,
  UNIQUE (org_id, number)
);

CREATE TABLE inventory_count_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  count_id uuid NOT NULL REFERENCES inventory_counts(id) ON DELETE CASCADE,
  variant_id uuid NOT NULL REFERENCES variants(id),
  expected_qty numeric(14,3) NOT NULL,
  counted_qty numeric(14,3) CHECK (counted_qty >= 0),
  unit_cost numeric(18,4) NOT NULL DEFAULT 0,
  UNIQUE (count_id, variant_id)
);

-- ── Audit ────────────────────────────────────────────────────────────────────
CREATE TABLE audit_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id uuid REFERENCES orgs(id) ON DELETE CASCADE,
  user_id uuid,
  action text NOT NULL,
  entity text,
  entity_id text,
  payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_org_idx ON audit_log (org_id, id DESC);
CREATE TRIGGER audit_log_append_only BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
`;
