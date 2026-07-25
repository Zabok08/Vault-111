# Upgrade to Version 3 alpha.13

Alpha.13 fixes mobile navigation overlap and further compacts the mobile interface. It does not require a database migration.

## Changes

- The tab navigation and tab content now use separate layout layers.
- Only the content panel scrolls, so cards, forms, and lists remain clipped beneath the navigation.
- Mobile typography, spacing, cards, notices, forms, and controls are smaller.
- Mobile action toolbars use two columns where space permits.
- The 40%-height mobile window and draggable collapsed launcher remain unchanged.

## Deploy

1. Deploy the alpha.13 repository contents to the existing Render service.
2. Confirm `/health` reports version `3.0.0-alpha.13` and `database: connected`.
3. Generate the production userscript:

   ```powershell
   npm run client:configure -- https://vault111-control-center.onrender.com
   ```

4. Publish the generated `client/Vault-111-Control-Center-v3.0.0-alpha.13-production.user.js` as the installable userscript.

No secrets, Torn API keys, or database credentials belong in the userscript or repository.
