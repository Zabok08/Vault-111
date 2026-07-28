# Vault 111 Control Center v3.6.0

Version 3.6.0 is the first stable Vault 111 Control Center release.

## Included modules

- Organized Crime planner and optimizer
- Unified faction dashboard and current chain status
- Ranked War tracker, target list, and officer notes
- Ranked War payout calculator and finalized payout history
- Privacy-aware member analytics for battle stats, drugs, and cooldowns
- Shared schedule, announcements, reminders, and optional notifications
- Owner and Administrator access controls, role mappings, and audit history

## Stable-release improvements

- Tampermonkey and Torn PDA support
- Single-instance protection and a draggable launcher
- Mobile viewport, keyboard, modal, and navigation fixes
- Accessible keyboard navigation, visible focus states, and reduced-motion support
- Automatic planner synchronization and self-only personal-stat synchronization
- Production HTTPS backend support with secure API-key encryption and server-enforced permissions

## Upgrading

Install `Vault-111-Control-Center-v3.6.0-release.user.js` over the existing Vault 111 Control Center script. Existing backend accounts, encrypted API keys, assignments, permissions, and shared data remain unchanged.

For Torn PDA, keep the userscript injection time set to **END**.

The standalone mobile diagnostic userscript used during alpha testing is not part of the stable release and should be removed.

## Deployment

The stable production userscript connects only to:

`https://vault111-control-center.onrender.com`

This release changes application and client version labels only. It does not require a database migration.
