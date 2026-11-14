# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [1.0.0] — 2026-11-14

### Added
- Domain core (`packages/core`): append-only stock ledger with weighted-average costing, cart pricing with proportional discount allocation, mixed-payment settlement, debt allocation and aging, ABC analysis, stock-count variance, FEFO batch picking, EAN-13 / Code 128 validation, role and warehouse permissions.
- PostgreSQL schema with trigger-materialised balances, a `CHECK (qty >= 0)` oversell guard, append-only ledgers, cycle-free nested categories and a `stock_drift` consistency view.
- Shared route layer (zod validation, permissions, automatic audit log) mounted by Fastify and by the in-browser demo.
- Fastify API with scrypt-hashed passwords, revocable httpOnly sessions, a CSRF guard and login rate limiting; `migrate` and `seed` CLI.
- React web app: dashboard, keyboard-first POS with receipt printing (58/80 mm) and sharing, products (variants, packaging, barcodes, labels, Excel/CSV import with preview), stock ledger, receiving, transfers, write-offs, stock counts, purchase orders with partial receiving, suppliers and customers with debts, sales and returns, reports with CSV/Excel export, alerts, audit log and settings.
- Uzbek (Latin), Russian and English interfaces; dark and light themes; layout responsive down to 375 px.
- GitHub Pages demo: PGlite (Postgres in WebAssembly) in a Web Worker, seeded with Demo Market (≈300 products, 90 days of history), with reset and a role switcher.
- Test suites: property-based core tests, service tests on PGlite, HTTP and concurrency tests on PostgreSQL 16, Playwright end-to-end tests on the demo build.
- Docker image, Docker Compose with healthchecks, GitHub Actions CI and a Pages deployment workflow.
