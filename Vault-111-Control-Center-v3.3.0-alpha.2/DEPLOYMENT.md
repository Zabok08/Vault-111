# HTTPS deployment

The localhost server is for one-computer development only. Faction-wide access requires a stable public hostname, HTTPS, and a PostgreSQL database that is not exposed to the internet.

## Recommended shape

- A container host for this API.
- A managed PostgreSQL database with TLS, encrypted backups, and point-in-time recovery.
- A hostname such as `control.your-domain.example`.
- TLS terminated by the hosting platform or Caddy.
- One application replica until synchronization scheduling is moved to a dedicated worker.

## Recommended free pilot: Render + Neon

Use Render Free for the Docker backend and Neon Free for durable PostgreSQL. Render supplies an HTTPS `onrender.com` address, so a custom domain is optional. Do not use Render's free PostgreSQL plan for durable data because free Render databases expire.

The repository includes `render.yaml`. Follow `DEPLOY_RENDER_NEON.md` for the complete beginner-friendly deployment, secret entry, Owner bootstrap, production userscript, pilot, and backup steps.

Render terminates TLS and redirects HTTP traffic to HTTPS, so the Caddy files are not used on this managed path.

## Required production values

Start from `.env.production.example` but place the actual values in the host's secret manager. Set:

- `DATABASE_URL` to the pooled production PostgreSQL TLS connection string.
- `DIRECT_URL` to the direct PostgreSQL TLS connection string used by migrations and backups.
- `PUBLIC_BASE_URL` to the exact HTTPS origin.
- `VAULT111_FACTION_ID` to the numeric faction ID.
- `ALLOWED_ORIGINS=https://www.torn.com`.
- `HOST=0.0.0.0` and `TRUST_PROXY=true` when the platform uses a trusted reverse proxy.
- Fresh production-only `JWT_SECRET` and `KEY_ENCRYPTION_KEYS_JSON` values.

Never reuse development encryption keys unless deliberately migrating the encrypted database. Never upload `.env` or `.env.production`.

For a self-hosted test server, generate secrets without displaying them:

```powershell
Copy-Item .env.production.example .env.production
node scripts/generate-secrets.mjs .env.production
```

Set a strong, matching `POSTGRES_PASSWORD` in the shell and database URL, set `CONTROL_CENTER_DOMAIN`, point DNS to the server, then start:

```powershell
docker compose -f docker-compose.production.example.yml up -d --build
```

Caddy obtains and renews the HTTPS certificate after ports 80 and 443 and the hostname are reachable.

## Configure the Tampermonkey client

After the deployed health endpoint returns `ok: true` and `database: connected`, generate a production client:

```powershell
npm run client:configure -- https://control.your-domain.example
```

Install the resulting `client/Vault-111-Control-Center-v3.3.0-alpha.2-production.user.js`. The generator adds only the exact backend hostname to `@connect`; it does not use a wildcard or include secrets.

## Before inviting faction members

1. Confirm database backups and restore procedures.
2. Confirm `/health` over HTTPS.
3. Connect the Owner and run one faction synchronization.
4. Create explicit backend role mappings for faction positions.
5. Verify a Member can read the snapshot but receives `403` for synchronization and assignment writes.
6. Verify logs redact authorization headers, API keys, access tokens, and refresh tokens.
7. Publish a short privacy notice explaining stored fields, retention, deletion, and contact information.
8. Pilot with officers before distributing to the full faction.
9. Verify analytics consent, exact-stat visibility, consent withdrawal/deletion, and privileged-read audit events.
