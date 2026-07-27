# Free pilot deployment: Render + Neon

This is the recommended no-cost pilot setup:

- Render Free runs the secure backend and supplies an HTTPS `onrender.com` address.
- Neon Free stores the PostgreSQL data.
- Tampermonkey remains the only interface faction members install.
- No purchased domain is required.

The free tiers are suitable for an officer pilot, not guaranteed production uptime. Render sleeps after 15 minutes without inbound traffic and can take about one minute to wake. The userscript safely wakes it with a read-only health check before sending login, synchronization, assignment, payout, or schedule requests.

## Before starting

Confirm that the root of the GitHub repository contains:

- `Dockerfile`
- `render.yaml`
- `package.json`
- `prisma/`
- `src/`
- `client/`

Upload the contents of this project folder, not just the Tampermonkey `.user.js` file. Never upload `.env` or `.env.production`.

## 1. Prepare production secrets locally

In PowerShell, open this project folder and run:

```powershell
Copy-Item .env.production.example .env.production
npm run secrets:generate -- .env.production
```

This creates fresh production-only JWT and API-key encryption secrets directly in the ignored `.env.production` file without printing them.

Keep `.env.production` private and backed up securely. Losing `KEY_ENCRYPTION_KEYS_JSON` makes encrypted Torn keys unrecoverable. Do not reuse the localhost encryption key unless you deliberately migrate the existing encrypted database.

## 2. Create the free Neon database

1. Sign in at [Neon](https://console.neon.tech/).
2. Create a project named `vault111-control-center`.
3. Choose a region near the Render region you will use.
4. Open **Connect**.
5. Copy the **pooled** connection string. Its hostname normally contains `-pooler`. This becomes `DATABASE_URL`.
6. Disable connection pooling in the connection dialog and copy the **direct** connection string. This becomes `DIRECT_URL`.
7. Confirm both URLs include `sslmode=require`.

Put both values in your local `.env.production` file as well. This file is ignored by Git and is used later for safe Owner setup and database maintenance.

## 3. Finish the local production file

In `.env.production`, set:

- `DATABASE_URL` to the Neon pooled URL.
- `DIRECT_URL` to the Neon direct URL.
- `VAULT111_FACTION_ID` to the numeric Vault 111 faction ID.
- `PUBLIC_BASE_URL` can remain a placeholder until Render supplies the address.

Do not change the generated secret values.

## 4. Create the Render service

1. Sign in at [Render](https://dashboard.render.com/).
2. Choose **New**, then **Blueprint**.
3. Connect the GitHub repository containing this project.
4. Render reads `render.yaml` and creates one free Docker web service.
5. When prompted, enter:

   - `DATABASE_URL`: the Neon pooled connection string.
   - `DIRECT_URL`: the Neon direct connection string.
   - `VAULT111_FACTION_ID`: the numeric faction ID.
   - `KEY_ENCRYPTION_KEYS_JSON`: the complete value after the equals sign in `.env.production`.

6. Render generates `JWT_SECRET` automatically. Do not replace it on later deploys.
7. Start the deployment.

To copy the encryption value on Windows without displaying it in the terminal:

```powershell
$secretLine = Get-Content .env.production | Where-Object { $_ -like 'KEY_ENCRYPTION_KEYS_JSON=*' }
$secretLine.Substring('KEY_ENCRYPTION_KEYS_JSON='.Length) | Set-Clipboard
Remove-Variable secretLine
```

Paste the clipboard contents only into Render's `KEY_ENCRYPTION_KEYS_JSON` field.

The container automatically applies committed Prisma migrations before starting. Render supplies `PORT`, its public HTTPS URL, and TLS. The application derives `PUBLIC_BASE_URL` from Render's own `RENDER_EXTERNAL_URL`.

## 5. Confirm the deployment

Render will show an address similar to:

```text
https://vault111-control-center.onrender.com
```

Open:

```text
https://vault111-control-center.onrender.com/health
```

Continue only when it reports:

```json
{"ok":true,"version":"3.6.0-alpha.2","database":"connected"}
```

The first visit after inactivity can take about one minute on the free service.

## 6. Build the production Tampermonkey client

From the project folder, use the exact Render origin with no trailing path:

```powershell
npm run client:configure -- https://vault111-control-center.onrender.com
```

Replace the example address with the one Render assigned. This creates:

```text
client/Vault-111-Control-Center-v3.6.0-alpha.2-production.user.js
```

The generated file contains only the public HTTPS backend address and its exact Tampermonkey `@connect` hostname. It contains no server secret or Torn API key.

Install this production file in Tampermonkey for the pilot. The localhost `.user.js` file will not connect to Render.

## 7. Grant the first Owner

1. Install the production userscript.
2. Open a Torn faction page.
3. Use the **API Key** tab to connect once with your own Torn key.
4. Back in local PowerShell, run:

```powershell
npm run owner:grant -- YOUR_NUMERIC_TORN_ID --env-file=.env.production
```

5. Disconnect and reconnect in the userscript so the new Owner role is included in the session.
6. Run **Sync Vault 111 from Torn**.

This local command connects directly to Neon. It avoids creating a dangerous public Owner-bootstrap endpoint.

## 8. Map trusted faction positions

After the first faction synchronization, map only positions that should have write access:

```powershell
npm run role:map -- "Exact Torn Position" OC_PLANNER --env-file=.env.production
```

Allowed mappings are `ADMIN`, `OC_PLANNER`, `WAR_MANAGER`, `OFFICER`, and `MEMBER`. `OWNER` cannot be granted by position mapping. Unmapped positions remain read-only Members.

## 9. Pilot checklist

- Owner can connect, sync faction data, and save a shared assignment.
- A regular Member can read the planner but receives `403` for protected writes.
- Each pilot member connects only their own key, reviews the analytics consent notice, and uses **Sync My Stats**.
- A Member sees only their own exact analytics; Owner/Admin can see opted-in analytics; other roles receive private placeholders.
- Disabling analytics deletes that member's current analytics and history.
- Owner, Admin, or War Manager can use **Sync Ranked War**; Members can refresh and read the resulting shared tracker.
- Owner, Admin, War Manager, or Officer can save target notes; regular Members can read them.
- All connected roles can read the Schedule. Owner/Admin/Officer can manage every manual event type, War Managers can manage Chain/Ranked War events, OC Planners can manage OC events, and Members receive no edit controls.
- Upcoming synchronized wars and OC ready times appear automatically; member reminder preferences do not affect other users.
- Browser reminders are tested with Torn open; they are not treated as offline push notifications.
- Owner can open Admin, change a test position mapping, and confirm affected users are asked to reconnect.
- Administrator can open Admin and read mappings, user status, health, and audit history without receiving mutation controls.
- A regular Member receives no Admin tab and receives `403` from protected Admin endpoints.
- No administration response or browser view contains encrypted keys, fingerprints, token hashes, IP hashes, or user-agent strings.
- The userscript shows a wake message after the free service has been idle.
- No `.env`, `.env.production`, database URL, encryption key, JWT secret, or Torn key exists in GitHub.
- Keep an offline backup of `.env.production`.

## Database backup

Neon Free includes short point-in-time recovery, but keep independent backups before schema changes. Use the direct, non-pooled Neon URL with PostgreSQL 17 `pg_dump`:

```powershell
$env:DATABASE_URL = (Get-Content .env.production | Where-Object { $_ -like 'DIRECT_URL=*' }).Substring('DIRECT_URL='.Length)
pg_dump --format=custom --no-owner --no-acl --dbname="$env:DATABASE_URL" --file="vault111-$(Get-Date -Format yyyyMMdd-HHmmss).backup"
Remove-Item Env:DATABASE_URL
```

Store the backup and `.env.production` separately in secure locations. Test restoration before relying on the system faction-wide.

## Free-tier limits

- Render Free sleeps after 15 minutes without inbound traffic and takes about one minute to wake.
- Render's filesystem is temporary; all durable data must remain in Neon.
- Render Free is not covered by a production uptime guarantee.
- Neon Free has usage and storage limits and a short restore window.

Move the Render service to a paid instance before broad faction-wide use if cold starts or uptime become disruptive.
