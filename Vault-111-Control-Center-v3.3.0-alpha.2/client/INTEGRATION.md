# Planner integration

`Vault-111-Control-Center-v3.3.0-alpha.2.user.js` is the working Control Center client with the backend connection merged directly into it.

The planner and optimizer remain available. The old local key manager and pre-release fictional-data mode have been removed. The visible **API Key** tab:

- submits the current member's key to `/v1/auth/login` without retaining it in Tampermonkey;
- stores only backend access and refresh tokens in Tampermonkey;
- restores the backend session after page reload;
- lets permitted roles synchronize faction members and available OCs through the backend;
- lets every authenticated member load the latest shared member/crime snapshot;
- synchronizes only the authenticated member's own Torn crime-category stats;
- provides an explicit opt-in notice before storing battle stats, drug totals, rehabilitation totals, overdoses, and cooldown data;
- shows exact analytics only when the backend returns them for the member, Owner, or Administrator;
- provides previous-sync, 24-hour, 7-day, and 30-day growth summaries from bounded snapshots;
- lets members disable analytics and delete their stored current record and history;
- loads the selected member's last five synchronized ranked wars only when their profile opens, then shows successful-hit categories, fixed payout points, payout-report status, and finalized pay;
- uses shared normalized crime stats in the existing local optimizer;
- loads shared crime assignments;
- gives backend assignments priority over local manual locks;
- hides assignment selectors for connected read-only roles;
- sends permitted assignment changes to the server with the crime version;
- handles `401`, `403`, and `409` without treating UI controls as a security boundary.
- provides a Ranked War tab with shared scores, timing, attack activity, and member participation;
- allows every connected faction member to read war data while showing Torn synchronization only to Owner, Admin, and War Manager roles;
- shows the current/scheduled opponent roster with public status, hospital timing, search, filters, and attack/profile links;
- lets Owner, Admin, War Manager, and Officer edit shared per-target notes while Members receive a read-only view;
- provides a Payouts tab with configurable pools, fixed hit points, manual adjustments, and shared reports;
- awards 1 point for a ranked-war hit, 0.5 for an out-of-war chain hit, and 0.25 for an out-of-war non-chain hit; respect and assists do not affect payouts;
- lets Owner, Admin, and War Manager edit and finalize payout drafts, while all other connected faction roles receive a read-only view;
- stores immutable finalized member amounts so later war synchronization cannot silently alter a locked report;
- lets Owner and Admin reopen a finalized report, with every settings, adjustment, finalize, and reopen action audited;
- copies faction-ready payout summaries and downloads CSV reports without including access tokens or API keys;
- keeps final payout amounts inside the planner on desktop and mobile, and links directly to Torn's faction payout controls;
- shows a locally updating countdown to each Planning Queue crime's synchronized Torn `ready_at` time without making extra API requests.
- preserves the current tab, scroll position, member search, and keyboard focus during client redraws and background synchronization;
- exposes accessible tabs, labeled inputs, focus-managed member dialogs, live status announcements, reduced-motion behavior, and guarded loading states.
- prevents duplicate planner instances, lets users drag and persist the collapsed launcher position, and keeps the mobile panel compact and scrollable;
- automatically synchronizes the authenticated member's approved crime and analytics stats when the API Key screen is opened, no more than once every five minutes;
- reminds members to enter only their own key and explains that a sleeping free Render service can take about one minute to respond.
- keeps the navigation in a separate fixed layer so scrolling tab content cannot overlap it;
- uses smaller mobile typography, spacing, cards, form controls, and two-column action toolbars.
- sizes the content area from the header's actual rendered height so the panel's bottom edge is not clipped.

Before deployment, change `BACKEND_API` and replace the localhost `@connect` entries with the exact HTTPS production hostname. Do not use `@connect *`.

The backend ingests faction members, Recruiting/Planning crimes, self-synchronized crime-category stats, and explicitly opted-in member analytics. A member's session cannot synchronize another member's private data. Backend data is the sole live data source; a cached shared snapshot remains available for display during a temporary backend outage.

Do not copy access tokens, refresh tokens, or API keys into planner exports, logs, DOM attributes, URLs, or error messages.
