# Adversarial audit disposition and continuation — 10 October 2026

## Evidence boundary

Reviewed the supplied **Ngombe Herdbook Final Audit, Red-Team and Improvement Report**, including its later corrections in sections 12–15, against the released baseline `c5303a2ca2cf6fd526f5ba8e00a7f64a53e0b32b` and PR #67 head `1a55aab66720470ec57693139ece66f654f3a493`. PR #67 is not merged. Its exact-head browser CI run #189 passed. That does not prove deployed authenticated offline access or expired-token recovery.

The attached checklist image is only **116 × 250 pixels**. Some security headings are readable, but the smaller lines are not reliably transcribable. No claim of complete screenshot compliance is made. The report's early scorecard is not a current release score: its own later sections withdraw several original claims.

## Accepted findings and sequencing

| Finding | Current evidence / decision |
| --- | --- |
| Exact shell URLs and import coverage | VERIFIED mismatch: HTML requests `manifest.json?v=15`, while the cache list used the plain URL. Next bounded correction adds the exact URL and a source-graph CI guard. |
| Duplicate module URLs | VERIFIED: three duplicate paths in the PR #67 startup graph (`local-db`, `feed-inventory`, `requirement-ration-comparison`). These currently have no module-level mutable runtime state. Known stateful modules use one URL. Guard stateful duplicates now; normalize the remaining paths in a later versioned change, particularly before caching a shared DB connection. Duplicate URLs do not by themselves prove cross-farm exposure. |
| Authentication client dependency | PR #67 vendors the official client, bounds membership evidence and fixes duplicate client initialization. Unexpired synthetic offline reopening passes. Token expiry, revocation and real-device behavior remain UNKNOWN. The 14-day ceiling is an engineering policy, not an empirically proven farm requirement. |
| Network-first shell waits and update lifecycle | VERIFIED no network timeout or update prompt. Keep deferred activation; next offline unit must test slow/hung requests and safe updates before changing the worker strategy. |
| Backup and recovery | Existing recovery comparison/ownership-claim evidence does not prove a general export-and-restore facility. Keep Restore disabled. Prove a versioned recovery rehearsal in an isolated profile before migration or origin changes. |
| Storage capacity and images | VERIFIED original photo blobs stored without compression; manifest icons are external. Test quota failure and recovery; design local icons and photo processing separately. Do not promise installed-app/offline completeness from shell loading alone. |
| Milk correctness | VERIFIED integer millilitres, default session duplicate prevention and append-only correction exist. Do not replace them with the audit's standalone module. Request idempotency, original-event actor/device attribution and future synced corrections are separate remaining work. |
| Treatment withdrawal | VERIFIED the local health UI lacks structured medicine/dose/withdrawal fields and a delivery-eligibility rule. High priority after offline/recovery gates. Record all production; restrict delivery, never invent medication periods. |
| Price history | Repository contract documents the owner's KSh 49/L / Saturday terms. These are declared project inputs, not arbitrary defaults; they are not evidence of current buyer prices. Dated price snapshots and settlement rules are still needed for changes and other farms. |
| Generic writer identity fields | VERIFIED payload spreading can override generated `id`, `clientId` and `kind`; `farmId` remains protected. Add a focused malicious-payload test and correction separately. Current farm access is not shown to be bypassed by this finding. |
| Query cost and DB lifecycle | VERIFIED whole-store reads and repeated connections. Measure first; require preserved-row fixtures, backup/recovery and blocked-upgrade tests before indexes or shared connections. No v14 upgrade in this unit. |
| Dates and attribution | VERIFIED device-local date calculation and missing actor/device on original milk entries. Introduce explicit farm-day semantics and attributable new events separately; retain historical rows. |
| Focus and visual readability | VERIFIED the general focus ring is `#71b990`, placeholders are `#84988c`; some small navigation text remains. Measured accessibility improvements deserve a separate UI-only change. Landing reduced-motion exists, so “no reduced-motion” is too broad. |
| Landing performance | VERIFIED hero preload remains. Adopt measurement, data-saver behavior, concrete copy and truthful claims. Removing every photo, adopting a specific palette/font, or copying another landing page is a design preference, not an established defect. |
| Language, onboarding and field use | English-only interface, physical sunlight/dirty-hands testing and low-end-device performance remain open. Native-language review and a shadow pilot need real people; synthetic tests cannot substitute. |
| Legacy files | Dormant root files are not loaded by the active entry. Keep them unchanged under the existing preservation rule. Archive only as a separately reviewed unit after import checks; their presence alone does not prove current anonymous cloud access. |
| Live cloud security | Historical policy evidence is not a current all-table/view/function/bucket audit. Obtain read-only live evidence before cloud work; do not change RLS, schema or sync as a side effect of this review. |

## Screenshot security headings: architectural interpretation

| Readable topic | What is established / what is not |
| --- | --- |
| API keys server-side | CI scans deployable files for privileged credentials with synthetic rejection tests. Supabase's public anon key is intentionally a browser credential; moving it to a server would not replace RLS. Secret/service-role keys must remain absent. Live policy completeness is not proven. |
| CORS | Do not loosen CORS to mask failed authentication. Supabase controls its API responses. CORS is not authorization, and current browser CI uses isolated responses rather than certifying the live service. |
| Parameterized SQL | The active client uses Supabase queries; it does not assemble SQL strings. This does not certify unseen server functions. Review those only with actual schema/function evidence. |
| Email verification | No new verification or authentication policy is introduced. The live provider setting is UNKNOWN here. |
| Form validation | Existing domain validation and isolated browser tests are present. This is not universal validation proof; generic-writer reserved-field hardening and further hostile-input coverage remain separate. |
| Protected admin routes | No dedicated admin route is established in the current UI. Farm membership/scoped reads are tested; worker-specific authorization and shared-device confidentiality are not claimed. |

Other screenshot lines are too small to classify confidently. A readable source would be needed only if those exact additional requirements must be certified. No production credentials or farm records were used to compensate for the image quality.

Primary reference: Supabase API-key guidance, https://supabase.com/docs/guides/getting-started/api-keys — public browser keys differ from privileged secret keys; permissions depend on RLS. Source review performed 10 October 2026.

## This controlled unit

- Add a read-only source-graph test: exact module, stylesheet, manifest and locally configured SDK URLs must be precached; every listed asset must exist; known stateful modules must not be imported under multiple URLs.
- Synthetic fixtures prove missing query versions, missing transitive imports, missing files and duplicate stateful URLs are detected.
- Correct only the manifest cache URL, bump the shell cache version, and assert the manifest is present in isolated browser storage.
- Preserve the three currently stateless duplicate paths; do not silently normalize unrelated imports or introduce a bundler.
- No DB version, repository persistence, farm ownership, finance, nutrition, cloud-write or Restore change.

## Next gates

1. Explicitly authorized release of PR #67, then deployed startup/post-merge verification.
2. Review this dependent shell-contract unit, run its isolated browser gate and release separately.
3. Test expired-session recovery, slow-network fallback and same-user auth broadcasts without exposing farm records or clearing unsaved input.
4. Prioritize verified backup/recovery, quota-safe saves and reserved-field integrity ahead of further feature expansion.
5. Then delivery withdrawal, dated buyer terms, attributed milk events and a supervised shadow pilot. UI clarity improvements can proceed in isolated branches.

No production readiness percentage or “all security checks passed” assertion follows from this review. Keep cloud sync, general Restore, recommendations and automatic inventory consumption disconnected under their existing gates.
