# Nuengdeaw AI Community Edition

Open-source human simulation and Phasa Tawan API service by Sanom AI.

This repository contains the Community Edition of the Nuengdeaw AI stack: a Node.js API around the `nuengdeaw_simulator.js` runtime, with session management, multi-tenant auth, Phasa Tawan parsing, billing helpers, admin dashboard, Docker deploy, and Redis-ready persistence.

## License

This project is released under [AGPL-3.0](./LICENSE).

Why AGPL for this repo:

- free for self-hosting, research, and community use
- if someone modifies the system and exposes it as a network service, those changes should stay open too
- it fits an API-first product better than MIT if Sanom AI also wants to sell hosting and support

## Community Edition

Free to use for:

- local development
- self-hosted internal tools
- research and experimentation
- education and prototyping

Commercial services can be sold separately by Sanom AI for:

- managed hosting
- enterprise deployment
- SLA and support
- white-label dashboard
- custom Phasa Tawan rules and integrations

## Features

- HTTP API on Node.js
- multi-tenant API key auth and admin API
- Phasa Tawan parser, evaluator, and foundation validation
- billing quote, invoice summary, HTML invoice, PDF invoice
- usage export, rate limiting, metrics, and request IDs
- file persistence with optional Redis support
- Docker and production reverse-proxy setup
- admin dashboard at `/admin`
- hosted service page at `/hosted`

## Quick Start

1. Copy the example files:

```powershell
Copy-Item .env.example .env
Copy-Item tenants.example.json tenants.json
```

2. Set the minimum config in `.env`:

```env
PORT=3000
ADMIN_API_KEY=change-this-admin-key
```

3. Start the server:

```powershell
node server.js
```

4. Open:

- API health: `http://127.0.0.1:3000/v1/health`
- Metrics: `http://127.0.0.1:3000/v1/metrics`
- Admin dashboard: `http://127.0.0.1:3000/admin`
- Hosted page: `http://127.0.0.1:3000/hosted`

## Docker

Local:

```powershell
docker compose up --build
```

Production:

```powershell
docker compose -f docker-compose.prod.yml up --build -d
```

Main deploy files:

- [docker-compose.yml](/D:/TAWAN/P-/docker-compose.yml#L1)
- [docker-compose.prod.yml](/D:/TAWAN/P-/docker-compose.prod.yml#L1)
- [deploy/Caddyfile](/D:/TAWAN/P-/deploy/Caddyfile#L1)

## Main API

Public:

- `GET /v1/health`
- `GET /v1/metrics`

Tenant:

- `GET /v1/tenants/me`
- `POST /v1/sessions`
- `GET /v1/sessions/:id`
- `DELETE /v1/sessions/:id`
- `POST /v1/sessions/:id/tick`
- `POST /v1/sessions/:id/event`
- `POST /v1/sessions/:id/config`
- `POST /v1/sessions/:id/action`
- `POST /v1/sessions/:id/deception`
- `POST /v1/sessions/:id/phasa-tawan`
- `GET /v1/sessions/:id/memory`
- `POST /v1/sessions/:id/save`
- `POST /v1/sessions/load`

Phasa Tawan:

- `GET /v1/phasa-tawan`
- `GET /v1/phasa-tawan/validation`
- `POST /v1/phasa-tawan/parse`
- `POST /v1/phasa-tawan/evaluate`

Admin:

- `GET /v1/admin/usage`
- `GET /v1/admin/usage/export`
- `GET /v1/admin/usage/export.csv`
- `POST /v1/admin/usage/export-file`
- `GET /v1/admin/pricing`
- `POST /v1/admin/billing/quote`
- `POST /v1/admin/billing/invoice-summary`
- `POST /v1/admin/billing/invoice-summary-file`
- `POST /v1/admin/billing/invoice-html-file`
- `POST /v1/admin/billing/invoice-pdf-file`
- `POST /v1/admin/tenants`
- `PATCH /v1/admin/tenants/:id`

## Config

Start from:

- [\.env.example](/D:/TAWAN/P-/.env.example#L1)
- [tenants.example.json](/D:/TAWAN/P-/tenants.example.json#L1)
- [pricing.json](/D:/TAWAN/P-/pricing.json#L1)

Important runtime config:

- `ADMIN_API_KEY`
- `TENANTS_FILE`
- `REDIS_URL`
- `CORS_ALLOW_ORIGIN`
- `AUTO_SAVE_EVERY_MUTATIONS`
- `AUTO_SAVE_MIN_INTERVAL_MS`
- `BILLING_WEBHOOK_USAGE_THRESHOLD`

## Ethics and Acceptable Use

This project is intended for simulation, research support, training, and controlled product experimentation.

It must not be used for:

- coercive interrogation
- manipulative behavioral control
- privacy-invasive neuro or biosignal processing without authorization
- presenting outputs as definitive medical, legal, or truth-verification judgments

These constraints are aligned with the Phasa Tawan foundation and should remain in downstream deployments.

## Hosted by Sanom AI

Community Edition is free to self-host.

Sanom AI can separately offer:

- hosted API service
- managed deployment and upgrades
- enterprise support
- white-label UI
- custom integrations

The hosted landing page is served from [hosted.html](/D:/TAWAN/P-/hosted.html#L1) and will be exposed at `/hosted`.

## Before You Publish

Do not push:

- `.env`
- `tenants.json`
- `logs/`
- `billing/`
- `session-store/`

The repository now includes [\.gitignore](/D:/TAWAN/P-/.gitignore#L1) for that.

## Validation

Run:

```powershell
node production-check.js
```

This validates:

- syntax
- foundation sync
- smoke test
- billing verification
