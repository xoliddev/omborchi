<div align="center">

# Omborchi

**Inventory, point of sale and reporting for small and medium shops in Uzbekistan:** groceries, wholesalers, pharmacies and building-materials stores.

**English** · [O‘zbekcha](README.uz.md)

[![Live demo](https://img.shields.io/badge/live%20demo-xoliddev.github.io%2Fomborchi-0e6b73?style=flat-square)](https://xoliddev.github.io/omborchi/)
[![CI](https://github.com/xoliddev/omborchi/actions/workflows/ci.yml/badge.svg)](https://github.com/xoliddev/omborchi/actions/workflows/ci.yml)
[![Pages](https://github.com/xoliddev/omborchi/actions/workflows/pages.yml/badge.svg)](https://github.com/xoliddev/omborchi/actions/workflows/pages.yml)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?style=flat-square)
[![License: MIT](https://img.shields.io/badge/license-MIT-lightgrey?style=flat-square)](LICENSE)

![Omborchi dashboard](docs/screenshots/dashboard.png)

</div>

## Try it in 10 seconds

**[xoliddev.github.io/omborchi](https://xoliddev.github.io/omborchi/)** opens a working copy of **Demo Market**: two shops and a central warehouse, about 300 products, and 90 days of trading history.

The demo has no backend. **PostgreSQL itself runs in your browser** ([PGlite](https://pglite.dev), Postgres compiled to WebAssembly) inside a Web Worker. It uses the **same migrations, the same route handlers, the same zod validation and the same domain core** as the real server. Your sales are stored in IndexedDB, so they are still there after a reload. *Reset demo data* rebuilds the shop. *View as* switches between owner, manager, cashier and storekeeper so you can see the role permissions take effect.

| Real in the demo | Simulated in the demo |
|---|---|
| PostgreSQL schema, triggers, constraints, SQL reports | Payme / Click / Uzum approvals (a pluggable `PaymentProvider` interface; the bundled providers approve instantly with a fake reference) |
| Stock ledger, weighted-average costing, FEFO batches, debts and aging | Sign-in (the demo switches users instead; the server uses scrypt and httpOnly sessions) |
| Permissions and per-warehouse scoping (enforced in the route layer) | The 90-day history is generated with the real ledger code, not typed in by people |
| POS, returns, transfers, stock counts, purchase orders, imports and exports, printable receipts | Camera barcode scanning needs a browser with `BarcodeDetector` (Chrome/Edge on Android, desktop Chrome); every other browser falls back to typed input |

<table>
<tr>
<td width="62%"><img src="docs/screenshots/pos.png" alt="Point of sale with the cart drawn as a thermal receipt"></td>
<td><img src="docs/screenshots/mobile.png" alt="Dashboard on a 375 px phone"></td>
</tr>
</table>

## What it does

- **Organisations and roles.** Multi-tenant. The roles are owner, manager, cashier and storekeeper. Access can be limited to specific warehouses and is checked on the server for every request.
- **Catalogue.** Nested categories of any depth, with a trigger that prevents cycles. Units of measure (dona, kg, m, l, quti…) with package conversion, e.g. 1 box = 12 pieces. Variants, SKUs, EAN-13 / Code 128 barcodes, in-store EAN-13 generation and label printing. Retail and wholesale price lists.
- **Warehouses and stock.** Any number of shops and warehouses. Stock lives in an **append-only movement ledger**: receipts, sales, returns, transfers, write-offs and count adjustments. Balances are materialised by a database trigger in the same transaction and can never go negative.
- **Costing.** Weighted-average cost (WAC) drives COGS and gross profit (the reasoning is under [Design decisions](#design-decisions)). Batches carry expiry dates and are picked first-expired-first-out.
- **Purchasing.** Suppliers, purchase orders, partial receiving, supplier debts and payments.
- **Point of sale.** Built for the keyboard and a USB barcode scanner: <kbd>F2</kbd> search, <kbd>Enter</kbd> add, <kbd>F4</kbd> pay, <kbd>F6</kbd> customer, <kbd>F7</kbd> discount, <kbd>F8</kbd> clear. Works on a tablet. Supports line and receipt discounts, package units, and mixed payments (cash with change, card, Payme/Click/Uzum). Credit sales (*nasiya*) carry a due date and an optional credit limit. Cashier shifts end with cash reconciliation. Receipts print at 58 or 80 mm and can be shared or copied for Telegram.
- **Stock count (revizion).** Expected quantities are snapshotted when the count starts. Items can be counted by scan or by typing. A variance report shows shortage, surplus and accuracy. Applying the count posts adjustments relative to the snapshot, so sales made during the count are kept.
- **Alerts.** Low stock per shop. Expired batches and batches expiring soon, with one-click write-off.
- **Reports.** Revenue and gross profit per day, top products, ABC analysis, stock value by warehouse and category, dead stock, cashier shift reports, and debt aging for customers and suppliers. Every report has date ranges and CSV / Excel export.
- **Import.** Products can be imported from Excel or CSV, with a validation preview row by row (unknown unit, bad EAN check digit, duplicate SKU or barcode) before anything is saved. Opening stock can be included.
- **Audit log.** Every mutation is recorded with its user and input, passwords redacted, and cannot be edited.
- **Languages and formats.** Uzbek (Latin), Russian and English. UZS formatting. Asia/Tashkent business days. Dark and light themes. Responsive down to 375 px.

## Architecture

```mermaid
flowchart LR
  subgraph Browser
    UI["React SPA<br/>(Vite, TanStack Query)"]
    W["Web Worker<br/>(demo build only)"]
  end
  subgraph "packages/app — shared"
    R["Route table<br/>zod · permissions · audit"]
    S["Services<br/>sales · stock · purchasing · reports"]
  end
  CORE["packages/core<br/>ledger · WAC · pricing · payments<br/>debts · ABC · FEFO · barcodes"]
  DB[("PostgreSQL 16<br/>append-only ledger + trigger")]
  PGL[("PGlite<br/>Postgres in WASM · IndexedDB")]
  API["apps/api<br/>Fastify · scrypt sessions"]

  UI -- "HTTP /api" --> API --> R
  UI -- "postMessage (demo)" --> W --> R
  R --> S --> CORE
  S -- "same SQL" --> DB
  S -- "same SQL" --> PGL
```

Each API operation is declared **once** in `packages/app` as a route: name, method and path, permission, zod input, handler and audit action. Fastify mounts the table as REST endpoints. The demo worker calls `dispatch()` directly. The typed client (`api.call('sales.create', input)`) infers inputs and outputs from that table, so the UI, the server and the demo cannot drift apart.

```
packages/core   framework-free domain logic, no I/O (property-tested)
packages/db     SQL migrations as TS modules, tiny Db interface, pg + PGlite adapters
packages/app    route table, services, demo-data generator
apps/api        Fastify server, auth, CLI (migrate / seed)
apps/web        React SPA; `--mode demo` builds the GitHub Pages version
e2e             Playwright against the demo build
```

## Data model

```mermaid
erDiagram
  orgs ||--o{ memberships : has
  users ||--o{ memberships : "belongs via"
  memberships }o--o{ warehouses : "scoped to"
  orgs ||--o{ warehouses : has
  categories ||--o{ categories : parent
  categories ||--o{ products : groups
  products ||--|{ variants : "sold as"
  products ||--o{ product_units : "packaged as"
  variants ||--o{ prices : "priced in"
  variants ||--o{ batches : "has expiry"
  stock_movements }o--|| variants : moves
  stock_movements }o--|| warehouses : "in"
  stock_balances }o--|| variants : "materialised"
  sales ||--|{ sale_lines : contains
  sales ||--o{ sale_payments : "paid by"
  sales ||--o{ sale_returns : "returned by"
  purchase_orders ||--|{ purchase_order_lines : contains
  goods_receipts ||--|{ goods_receipt_lines : contains
  debt_entries }o--|| customers : "receivable"
  debt_entries }o--|| suppliers : "payable"
```

Every table carries `org_id`. Money is `numeric(18,2)`, quantities `numeric(14,3)` (grams and millimetres), unit costs `numeric(18,4)`. Neither `stock_movements`, `debt_entries` nor `audit_log` can be updated or deleted: a trigger rejects it. The `stock_drift` view lists every balance that disagrees with its ledger, and the tests assert that it stays empty.

## Design decisions

| Choice | Why |
|---|---|
| **TypeScript everywhere, npm workspaces** | One language from SQL results to UI. The domain core has no dependencies, so it runs in Node, a Web Worker and tests unchanged. |
| **React + Vite SPA** (not Next.js) | The demo has to run with no server on GitHub Pages. A static SPA plus a worker does that naturally. |
| **Fastify + zod** | Fast, typed, small. zod schemas live in the shared route table, so the server and the demo validate identically. |
| **Plain SQL + migrations as TS modules** (instead of Drizzle/Kysely) | The same migration and query strings run on node-postgres and on PGlite. A ~20-line `Db` interface (`query`, `exec`, `tx`) is the only abstraction. The reports use recursive CTEs, window functions and `generate_series`, which read better as SQL. |
| **Weighted-average cost**, not FIFO | It matches how Uzbek accounting (1C "o‘rtacha tannarx") reports cost. Transfers, returns and count adjustments need no cost-layer bookkeeping, which keeps the ledger small enough to prove correct. Expiry is still tracked per batch (FEFO), independently of costing. |
| **Balances materialised by a trigger + `CHECK (qty >= 0)`** | Quantity consistency is guaranteed by the database, not by application code. Under concurrency, the second writer blocks on the row lock, sees the decremented stock and fails, so overselling is impossible even if a service has a bug. The service also locks the rows in a fixed order and computes WAC with the core. |
| **Sessions in Postgres, scrypt, httpOnly SameSite=Lax cookie** | Sessions can be revoked. No native dependencies (argon2 needs node-gyp). Non-JSON mutations are rejected as a CSRF guard. Login attempts are rate-limited. |
| **Hand-built SVG charts** | Small, themeable, accessible: crosshair tooltips, keyboard navigation, a "show as table" fallback, and a validated colour-blind-safe palette. |

## Quick start

### Docker (server + PostgreSQL 16)

```bash
cp .env.example .env            # set POSTGRES_PASSWORD and DEMO_PASSWORD
docker compose up -d --build    # http://localhost:8080 — register your business
docker compose exec api node cli.mjs seed   # optional: load Demo Market (owner@demo.uz / DEMO_PASSWORD)
```

Both services have healthchecks. The API runs migrations on start.

### Local development

```bash
npm ci
npm run dev:demo                # demo mode: everything in the browser, no database needed
# — or, against a real PostgreSQL —
export DATABASE_URL=postgres://omborchi:change-me@localhost:5432/omborchi
npm run seed                    # migrate + Demo Market
npm run dev:api & npm run dev   # API on :3000, web on :5173 (proxied)
```

### Environment

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | — (required) | PostgreSQL connection string |
| `PORT` | `3000` | API port inside the container |
| `APP_PORT` | `8080` | Published port in docker compose |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | `omborchi` / — / `omborchi` | Database credentials for compose |
| `COOKIE_SECURE` | `false` | Set `true` behind HTTPS |
| `SESSION_TTL_DAYS` | `30` | Session lifetime |
| `TRUST_PROXY` | `false` | Set `true` only behind a reverse proxy that sets `X-Forwarded-For` |
| `ALLOW_REGISTRATION` | `true` | Allow self-service sign-up of new businesses |
| `MIGRATE_ON_START` | `true` | Apply pending migrations at boot |
| `DEMO_PASSWORD` | `demo12345` | Password for users created by `seed` |
| `WEB_DIR` | set in the image | Serve the built SPA from the API |

## Tests

```bash
npm test            # domain core + services on PGlite (property-based)
npm run test:api    # HTTP API + concurrency on PostgreSQL 16 (TEST_DATABASE_URL)
npm run test:e2e    # Playwright on the demo build (desktop + 375 px mobile)
npm run lint && npm run typecheck
```

| Suite | Tests | What it proves |
|---|---|---|
| `packages/core` | 30 | Property-based (fast-check): **materialised balances never diverge from a fold over the ledger**, stock never goes negative, transfers conserve quantity and value, WAC stays within the inbound cost range, cart totals equal the sum of their lines, mixed payments settle exactly, aging buckets sum to the balance, ABC is monotonic, FEFO never over-picks, generated EAN-13s are valid. |
| `packages/app` | 20 | Services on real SQL (PGlite): a **property test of random receipts, sales, transfers, write-offs and counts** after which `stock_drift` is empty and the stored WAC equals the core fold; atomic rollback on oversell; credit limits; returns at the original cost; snapshot-relative counts; partial PO receiving; role and warehouse scoping; tenant isolation; append-only ledger; audit log; import validation; seeded reports. |
| `apps/api` | 8 | Over HTTP on PostgreSQL 16: register, sign in and out with an httpOnly cookie, CSRF guard, the full product → receipt → shift → sale → dashboard flow, a cashier signing in with limited rights. **Concurrency:** two cashiers selling the last item at once (exactly one succeeds); 20 parallel sales against 10 units (exactly 10 succeed, stock ends at 0); the database still refuses an oversell when the application check is bypassed. |
| `e2e` | 5 | A POS sale updates stock, the sales list and the dashboard; role switching; a transfer; reports and CSV export; the 375 px layout has no horizontal overflow. Every test fails on any console error. |

CI runs lint, typecheck, all suites (with a `postgres:16` service), the Playwright run and a Docker build on every push. The Pages workflow publishes the demo.

## License

[MIT](LICENSE) © 2026 xoliddev
