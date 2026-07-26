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

The shared ingestion snapshot stores only planning fields: member identity, faction position, level, OC occupancy, coarse Torn status/last-action data, available crime/slot data, and normalized crime-category stats explicitly synchronized by each member. The self-stat endpoints derive the Torn ID from the authenticated session, re-verify the encrypted key owner, and cannot accept a target member ID. Empty-slot checkpoint rates are key-owner-specific and are deliberately not published as shared recommendations.

Member analytics require explicit consent. The service requests only `user:battlestats`, the drugs category from `user:personalstats`, and `user:cooldowns`. It retains normalized battle values, named-drug totals, overdoses, rehabilitation totals, the current drug cooldown, and six-hour growth snapshots. Exact analytics are returned only to that member or a backend-authorized Owner/Administrator. Privileged overview reads and consent changes create audit events. Withdrawing consent deletes the current record and all stored snapshots for that member.

## Threats still requiring work

- Refresh-token reuse detection should revoke the entire token family.
- Scheduled membership/position re-verification is not implemented.
- Multi-instance rate limiting needs Redis or gateway enforcement.
- Secret-manager/KMS envelope encryption is preferable to environment-held master keys.
- Audit logs should be shipped to append-only storage.
- Scheduled OC ingestion still needs retry/backoff and centralized Torn rate-budget coordination.
- The companion stores tokens in Tampermonkey storage. Browser or extension compromise can steal them; keep tokens scoped and revocable.
