# Upgrade to alpha.11

Alpha.11 is the deployment-ready free-pilot release.

## Changes

- Adds a Render Blueprint for one free Docker web service.
- Adds the Render + Neon deployment and backup guide.
- Uses Neon's pooled URL for the application and direct URL for Prisma migrations.
- Derives the public HTTPS base address from Render automatically.
- Makes the Docker health check follow Render's dynamic `PORT`.
- Wakes a sleeping free backend with a read-only health request before protected work.
- Waits up to 90 seconds for a cold start and clearly explains the delay.
- Never retries a faction sync, personal-stat sync, login, or assignment mutation as part of wake handling.
- Lets Owner, role-mapping, diagnostics, and manual sync helpers use an ignored `.env.production` file.

## Local upgrade

Add the direct local database setting without displaying its credential:

```powershell
npm run env:ensure-local-direct-url
```

Then run:

```powershell
npm install
npm run db:generate
npm run build
npm test
```

Restart the backend, confirm `/health` reports `3.0.0-alpha.11`, and replace the Tampermonkey script with `client/Vault-111-Control-Center-v3.0.0-alpha.11.user.js`.

No database migration is added in this release. Existing users, encrypted API keys, crime data, assignments, and sessions remain compatible.
