# Security model

## Trust boundaries

Tampermonkey and all browser code are untrusted. The backend alone authorizes writes. A modified userscript may reveal buttons but cannot gain permissions.

Torn API keys are accepted only in a JSON POST body over HTTPS, verified directly with Torn, encrypted before persistence, redacted from logs, and never returned. The current scaffold retains them because later background sync needs them. If that requirement changes, delete them after identity verification.

## Key storage

API keys use AES-256-GCM with a random 96-bit nonce. The Torn user ID is authenticated as additional data, preventing ciphertext copied between users from decrypting. Ciphertexts include a key version for rotation. Encryption master keys must live outside the database.

## Sessions

Access tokens are short-lived signed JWTs. Refresh tokens are 256-bit random values; only their SHA-256 hashes are stored. Refresh use rotates and revokes the previous token. Logout revokes the presented token.

## Authorization

Permissions are mapped from backend roles and reloaded from the database on every authenticated request. Membership is checked at login and re-verified before every privileged Torn synchronization. Writes validate the faction ownership of every affected record and create audit events.

Administration reads are limited to Owner and Administrator roles. Only the Owner wildcard receives `admin.manage`. The Admin API exposes a boolean API-connection state and update time, never encrypted API keys, key fingerprints, refresh-token hashes, IP hashes, or user-agent strings. Faction-position mappings cannot assign the Owner role, use optimistic versions, and update only non-Owner users in the same faction. Owner accounts and the acting Owner cannot be suspended or have sessions revoked from the UI.

Access tokens carry a server-checked session version. Role-mapping changes, suspension, and explicit session revocation increment that version and revoke stored refresh sessions in one transaction. This invalidates existing access immediately on its next backend request. Restored users must authenticate again with their own Torn API key. Every administrative mutation creates a faction-scoped audit event.

Dashboard announcements are faction-scoped records. Every authenticated faction role may read active announcements, while only Owner, Administrator, and the mapped Officer role receive `announcements.manage`. Create, update, and delete requests are validated server-side, use optimistic versions to prevent silent overwrites, and create audit events. Announcement text is length-bounded and rendered as escaped plain text by the userscript.

Scheduled events are also faction-scoped and use optimistic versions. Owner, Administrator, and Officer roles may manage every manual event type. War Managers are limited to Chain and Ranked War events, OC Planners are limited to Organized Crime events, and Members are read-only. The backend enforces those limits on every create, update, and delete, including when an event's type changes. Automatic Ranked War and OC-ready events are derived from synchronized records and cannot be edited through schedule endpoints. Notification preferences are self-only. Reminder delivery is local to the authenticated member's userscript, and its deduplication log contains event IDs and send times—not API keys or access tokens.

The shared ingestion snapshot stores only planning fields: member identity, faction position, level, OC occupancy, coarse Torn status/last-action data, available crime/slot data, and normalized crime-category stats explicitly synchronized by each member. The self-stat endpoints derive the Torn ID from the authenticated session, re-verify the encrypted key owner, and cannot accept a target member ID. Empty-slot checkpoint rates are key-owner-specific and are deliberately not published as shared recommendations.

Member analytics require explicit consent. The service requests only `user:battlestats`, the drugs category from `user:personalstats`, and `user:cooldowns`. It retains normalized battle values, named-drug totals, overdoses, rehabilitation totals, the current drug cooldown, and six-hour growth snapshots. Exact analytics are returned only to that member or a backend-authorized Owner/Administrator. Privileged overview reads and consent changes create audit events. Withdrawing consent deletes the current record and all stored snapshots for that member.

Member war-and-payout history is shared faction-management data derived only from the backend's already synchronized ranked-war attacks and payout reports. The endpoint verifies that the requested Torn ID is an active member of the authenticated user's faction, returns at most five wars, and never includes API keys, sessions, battle stats, or private analytics.

## Threats still requiring work

- Refresh-token reuse detection should revoke the entire token family.
- Scheduled membership/position re-verification and automatic suspension for departed members are not implemented. The Admin view flags users absent from the latest faction sync for Owner review.
- Multi-instance rate limiting needs Redis or gateway enforcement.
- Secret-manager/KMS envelope encryption is preferable to environment-held master keys.
- Audit logs should be shipped to append-only storage.
- Unattended Torn ingestion still needs retry/backoff and centralized Torn rate-budget coordination.
- Reliable offline push notifications need a dedicated worker and push service; the userscript currently reminds members only while Torn is open.
- The companion stores tokens in Tampermonkey storage. Browser or extension compromise can steal them; keep tokens scoped and revocable.
