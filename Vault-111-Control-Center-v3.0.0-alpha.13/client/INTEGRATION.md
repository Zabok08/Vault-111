# Planner integration

`Vault-111-Control-Center-v3.0.0-alpha.13.user.js` is the working planner with the backend connection merged directly into it.

The planner and optimizer remain available. The old local key manager and pre-release fictional-data mode have been removed. The visible **API Key** tab:

- submits the current member's key to `/v1/auth/login` without retaining it in Tampermonkey;
- stores only backend access and refresh tokens in Tampermonkey;
- restores the backend session after page reload;
- lets permitted roles synchronize faction members and available OCs through the backend;
- lets every authenticated member load the latest shared member/crime snapshot;
- synchronizes only the authenticated member's own Torn crime-category stats;
- uses shared normalized crime stats in the existing local optimizer;
- loads shared crime assignments;
- gives backend assignments priority over local manual locks;
- hides assignment selectors for connected read-only roles;
- sends permitted assignment changes to the server with the crime version;
- handles `401`, `403`, and `409` without treating UI controls as a security boundary.
- shows a locally updating countdown to each Planning Queue crime's synchronized Torn `ready_at` time without making extra API requests.
- preserves the current tab, scroll position, member search, and keyboard focus during client redraws and background synchronization;
- exposes accessible tabs, labeled inputs, focus-managed member dialogs, live status announcements, reduced-motion behavior, and guarded loading states.
- prevents duplicate planner instances, lets users drag and persist the collapsed launcher position, and keeps the mobile panel compact and scrollable;
- automatically synchronizes the authenticated member's own crime stats when the API Key screen is opened, no more than once every five minutes;
- reminds members to enter only their own key and explains that a sleeping free Render service can take about one minute to respond.
- keeps the navigation in a separate fixed layer so scrolling tab content cannot overlap it;
- uses smaller mobile typography, spacing, cards, form controls, and two-column action toolbars.

Before deployment, change `BACKEND_API` and replace the localhost `@connect` entries with the exact HTTPS production hostname. Do not use `@connect *`.

The backend ingests faction members, Recruiting/Planning crimes, and opt-in self-synchronized crime-category stats. A member's session cannot synchronize another member's stats. Backend data is the sole live data source; a cached shared snapshot remains available for display during a temporary backend outage.

Do not copy access tokens, refresh tokens, or API keys into planner exports, logs, DOM attributes, URLs, or error messages.
