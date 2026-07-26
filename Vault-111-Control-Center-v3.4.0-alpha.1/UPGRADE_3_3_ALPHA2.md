# Upgrade to Version 3.3 alpha.2

This release completes the Member Overview module with compact War & Payout History inside each member profile.

## Included

- The last five synchronized ranked wars load only when a member profile is opened
- War opponent, date, outcome, and fixed-rule successful-hit categories
- One point per ranked-war hit, 0.5 per out-of-war chain hit, and 0.25 per other out-of-war hit
- Draft, finalized, and unavailable payout-report states
- Finalized payout totals across the displayed wars
- Mobile-friendly history cards, loading states, and a retry action
- Same-faction validation on every member-history request

## Deployment

1. Commit the complete Version 3.3 alpha.2 package to the existing GitHub repository.
2. Let Render deploy the commit.
3. Confirm:

   ```text
   https://vault111-control-center.onrender.com/health
   ```

   Expected:

   ```json
   {"ok":true,"version":"3.3.0-alpha.2","database":"connected"}
   ```

4. Install `client/Vault-111-Control-Center-v3.3.0-alpha.2-production.user.js`, or publish it as the repository's stable `Vault-111-Control-Center.user.js`.
5. Open **Members**, select a member, and confirm that **War & Payout History** loads.

There is no database migration in this update. It reads ranked-war attacks and payout reports already stored by the backend.
