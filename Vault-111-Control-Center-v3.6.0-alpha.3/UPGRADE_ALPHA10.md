# Upgrade to alpha.10

Alpha.10 is the publication-readiness UI and accessibility pass. It preserves the complete backend-connected planner while adding accessible tabs and dialogs, permanent field labels, visible keyboard focus, reduced-motion support, live feedback, guarded loading states, sticky navigation, larger touch targets, and final theme cleanup. It also prevents Settings and automatic refreshes from unexpectedly changing tabs. It does not change or regenerate the configured secrets in `.env`.

## Existing localhost installation

1. Stop the running backend.
2. Back up `.env` and the PostgreSQL database.
3. Replace the application files with this package, but keep the existing `.env`.
4. Run:

   ```powershell
   npm install
   npm run db:generate
   npm run db:deploy
   npm run build
   npm start
   ```

5. Confirm that `/health` reports `3.0.0-alpha.10`.
6. Replace the Tampermonkey script with `client/Vault-111-Control-Center-v3.0.0-alpha.10.user.js`.
7. Open the **API Key** tab and press **Sync My Crime Stats**.

The local installation prepared during development has already had this migration applied. Its `.env`, encrypted Torn key, faction members, crimes, sessions, and assignments were preserved.

## What is shared

The backend requests only Torn's `personalstats` `crimes` category for the authenticated key owner. It stores normalized crime offense counts, crime skill values, and derived planner categories. It does not request unrelated personal-stat categories.

Each member must connect with their own key and consent by connecting or pressing **Sync My Crime Stats**. The endpoint does not accept a target player ID, so one member cannot use it to synchronize another member's data.

The userscript deletes the obsolete `v111_ocp_keys_v1` Tampermonkey value so API keys retained by pre-backend releases do not remain stranded in browser storage. Backend sessions and encrypted server-side keys are unaffected.
