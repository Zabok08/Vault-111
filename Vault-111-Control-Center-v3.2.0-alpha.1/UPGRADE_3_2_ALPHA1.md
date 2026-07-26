# Upgrade to Version 3.2 alpha.1

This release adds the Ranked War Payout Calculator. It preserves the completed OC Planner, War Tracker, target list, and officer notes. It does not add participation requirements or perform payments inside Torn.

## Included

- One shared payout plan per synchronized ranked war
- Configurable whole-dollar payout pool
- Fixed payout points: ranked-war hit 1, out-of-war chain hit 0.5, and out-of-war non-chain hit 0.25
- Respect and assists excluded from payout calculations
- Expanded outgoing-attack ingestion across the ranked-war time window while keeping the War Tracker display limited to actual ranked-war hits
- Deterministic whole-dollar rounding that allocates the complete base pool
- Per-member manual bonuses, deductions, and optional notes
- Draft recalculation from the latest synchronized war data
- Finalize-and-lock workflow available only after Torn marks the war finished
- Immutable finalized member snapshots
- Owner/Admin-only reopening of finalized reports
- Owner, Admin, and War Manager editing
- Read-only payout access for every authenticated faction member
- Copyable faction report and downloadable CSV
- Optimistic versions and audit events for every shared change

## Deploy

1. Commit and push the complete project, including:

   - `prisma/migrations/20260725170000_ranked_war_payouts/migration.sql`
   - `src/payouts.ts`
   - the updated backend and client files

2. Let Render deploy the commit. The existing Docker startup runs `prisma migrate deploy`, which creates the payout tables without changing existing encrypted keys, sessions, roles, OC data, war data, target notes, or assignments.

3. Confirm:

   ```text
   https://vault111-control-center.onrender.com/health
   ```

   reports:

   ```json
   {"ok":true,"version":"3.2.0-alpha.1","database":"connected"}
   ```

4. Install or publish:

   ```text
   client/Vault-111-Control-Center-v3.2.0-alpha.1-production.user.js
   ```

5. Open Torn, close and reopen the Control Center once, and confirm the new **Payouts** tab appears.

6. An Owner, Admin, or War Manager must press **Sync Ranked War** after this deployment, even if the war was synchronized previously. The new sync adds the out-of-war attacks needed for the 0.5-point and 0.25-point categories.

7. Review the three hit-category counts in **Payouts** before finalizing the report.

## Permission behavior

| Role | Read reports | Edit drafts and finalize | Reopen finalized |
|---|---:|---:|---:|
| Owner | Yes | Yes | Yes |
| Admin | Yes | Yes | Yes |
| War Manager | Yes | Yes | No |
| Officer | Yes | No | No |
| OC Planner | Yes | No | No |
| Member | Yes | No | No |

Client-side button visibility is only a convenience. Every payout write is checked again by the backend.
