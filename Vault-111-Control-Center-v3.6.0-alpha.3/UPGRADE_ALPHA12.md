# Upgrade to Version 3 alpha.12

Alpha.12 is a client-focused usability release. It does not require a database migration.

## Changes

- The collapsed planner launcher can be dragged and remembers its position.
- The mobile planner is limited to roughly 40% of the screen height and remains scrollable.
- A singleton guard prevents more than one planner instance from opening on the same page.
- Opening the authenticated API Key screen automatically synchronizes the current member's own crime stats when the five-minute cooldown has elapsed.
- The API Key screen reminds members to enter only their own Torn API key and explains the possible one-minute free Render wake delay.

## Deploy

1. Deploy the alpha.12 repository contents to the existing Render service.
2. Confirm `/health` reports version `3.0.0-alpha.12` and `database: connected`.
3. Generate the production userscript:

   ```powershell
   npm run client:configure -- https://vault111-control-center.onrender.com
   ```

4. Publish the generated `client/Vault-111-Control-Center-v3.0.0-alpha.12-production.user.js` as the installable userscript.

No secrets, Torn API keys, or database credentials belong in the userscript or repository.
