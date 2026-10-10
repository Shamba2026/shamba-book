# Offline authentication boundary · 2026-10-10

The browser client is `@supabase/supabase-js` **2.117.3**, extracted from the official npm tarball into `assets/vendor/supabase-2.117.3.js`. The repository includes the package's MIT license. This avoids a third-party CDN request on each cold start; it does not change Supabase's session semantics.

- npm package integrity: `sha512-K+f8PimXDunPWQ63CKRXaF5pbVPJxmfw5ryAnh0s9S9PkwcuqBjiSpIaqpF7KLDljeYwXIL85ST8QxaO0+XuvA==`
- Tarball SHA-256: `a43200648c217e3fa801fb69e0938a1663f69edbb5b3e83d1901dbe47c3d573a`
- Extracted UMD SHA-256: `d6a5c4414a5d4ce646d9c1de223aa7067d3ff664c15394ffeb7fcffc763354a3`

An offline farm view requires both a session returned by the pinned client and matching local membership evidence checked online within the previous 14 days. The 14-day window is a conservative product policy, not a livestock or Supabase requirement. An invalid, future-dated (beyond five minutes) or older check fails closed. Reconnect to renew membership. No local farm row is deleted when access is refused.

The browser suite uses the real pinned client with synthetic token and membership responses. It proves an offline reopen while the synthetic token is unexpired, and refusal when membership evidence is stale. It does **not** prove behavior after token expiry, server-side revocation, a stolen unlocked device, or a real Supabase outage. Those remain separate release decisions. Cloud synchronization and Restore stay disabled.

Existing tabs may retain the previous service worker until closed; an online visit and new tab are needed to install the new cache. The shell does not cache auth/API responses.
