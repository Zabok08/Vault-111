# Upgrade to Version 3.6 alpha.3

This release corrects a mobile-only mounting failure. It preserves every backend feature and all stored data from Version 3.6 alpha.2.

## Mobile corrections

- Runs on `www.torn.com`, the bare `torn.com` domain, and Torn subdomains
- Recognizes `factions.php`, `/faction`, `/factions`, and routed faction pages such as `page.php?sid=factions`
- Rechecks mounting when a mobile page is restored from the browser's back/forward cache
- Rechecks mounting when the browser tab becomes visible
- Replaces a stale older userscript singleton instead of remaining hidden
- Detects an off-screen mobile panel or launcher and safely returns it to the visible viewport
- Retains the visual-viewport keyboard behavior from alpha.2
- Uses a broadly supported `vh` fallback on older mobile browser engines

## Install

The mobile fix is client-side and is compatible with the Version 3.6 alpha.2 backend.

1. Replace the existing Tampermonkey code with `Vault-111-Control-Center-v3.6.0-alpha.3-production.user.js`.
2. Make sure only the current **Vault 111 Control Center** script is enabled in the mobile userscript manager.
3. Save the script.
4. Completely close the Torn tab or mobile browser.
5. Reopen Torn and visit any faction page.

For a synchronized full release, deploy the complete alpha.3 package to Render and wait for:

```json
{"ok":true,"version":"3.6.0-alpha.3","database":"connected"}
```

No new database migration is introduced by alpha.3. The current-chain migration from alpha.2 remains included in the complete package.
