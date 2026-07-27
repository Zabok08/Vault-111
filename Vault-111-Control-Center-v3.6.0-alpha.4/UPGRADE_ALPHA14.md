# Upgrade to Version 3 alpha.14

Alpha.14 corrects bottom-edge clipping in both expanded and collapsed planner modes. It does not require a database migration.

## Cause and correction

The previous layout subtracted an assumed header height from the content height. The rendered header could be slightly taller because of text and padding, causing the root panel to crop the difference at the bottom. Collapsed mobile mode also used a maximum height shorter than the real header.

The panel now uses a flex-column layout. The browser measures the real header height, and the remaining space is assigned to the independently scrolling content area. Collapsed mode no longer applies any maximum-height clipping limit.

## Deploy

1. Deploy the alpha.14 repository contents to the existing Render service.
2. Confirm `/health` reports version `3.0.0-alpha.14` and `database: connected`.
3. Generate the production userscript:

   ```powershell
   npm run client:configure -- https://vault111-control-center.onrender.com
   ```

4. Publish the generated `client/Vault-111-Control-Center-v3.0.0-alpha.14-production.user.js` as the installable userscript.

No secrets, Torn API keys, or database credentials belong in the userscript or repository.
