# Upgrade to v3.6.0-alpha.4

This is a client-focused mobile startup recovery release.

## What changed

- Validates old locally stored cache, settings, and manual-lock data before rendering.
- Automatically retries once with a clean display cache if old data breaks the interface.
- Shows a visible recovery card instead of silently disappearing when rendering fails.
- Falls back to native browser storage/style behavior when a mobile userscript manager omits optional `GM_*` helpers.
- Adds stable GitHub update and download addresses so mobile installations can detect later releases.
- Retains the broader Torn mobile URL coverage and viewport recovery from alpha.3.

The recovery path does not delete backend session tokens or the API key stored on the backend.

## Install

1. Replace the existing Tampermonkey script with `Vault-111-Control-Center-v3.6.0-alpha.4-production.user.js`.
2. Confirm the installed script header shows version `3.6.0-alpha.4`.
3. Close all Torn tabs on the phone.
4. Reopen Torn, visit the faction page, and refresh once.

No database migration is required for this release.

If neither the Control Center nor the red recovery card appears, the userscript manager is not executing the script on that page. Record the phone browser, userscript manager, and exact Torn address for the next diagnostic step.
