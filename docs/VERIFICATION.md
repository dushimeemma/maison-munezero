# Verification record

Updated on 6 October 2026 for the Flutterwave payment switch. Hosted frontend/native checks for the payment branch are recorded on its pull request; the baseline results below remain identified separately where applicable.

| Check | Result / boundary |
| --- | --- |
| NestJS TypeScript compilation | Passed |
| API and payment-provider suites | 32 tests passed locally against PGlite and provider HTTP fixtures; hosted CI also runs against PostgreSQL 17 |
| Deployment and release automation suite | 26 tests passed: failure gates, revision matching, provider errors, packaging, reproducible release assets, publication ordering, retries, pagination and tag/asset conflicts |
| GitHub Actions workflow lint | Passed with actionlint 1.7.12; YAML/JSON structure and deployment dependencies checked |
| Production npm dependency audit | 0 known vulnerabilities reported at verification time |
| Flutter static analysis | Baseline passed; payment-branch verification runs in GitHub Actions |
| Flutter UI tests | Baseline 4 tests passed; a fifth exercises confirmation-page handoff and payment checking without another charge |
| Flutter release web compilation | Baseline passed in JavaScript/CanvasKit mode; payment-branch verification runs in GitHub Actions |
| Browser runtime smoke test | Not completed: the execution environment prevents Chromium's process/socket startup |
| Native Android compilation / device testing | Hosted baseline CI built the debug-signed review APK; physical-device testing is pending |
| Native iOS compilation / device testing | Hosted baseline CI compiled the unsigned iOS release; signing and device testing are pending |
| Docker build / deployment | Hosted baseline CI built the API container; live deployment is pending |
| Live Flutterwave/MTN, SMTP and Cloudinary transactions | Not performed; real merchant/service credentials were not provided |
| Live Render/Vercel deployment | Not executed; service setup and deployment secrets are pending |
| GitHub Actions execution | All five baseline verification jobs passed in [run 36998158035](https://github.com/dushimeemma/maison-munezero/actions/runs/36998158035), commit `79c1bb079e08434695a76f8f18cc6346e12bd931`; refer to the release PR for checks on the new configuration |
| Production GitHub Release publication | Provider-double tests passed; no live production release has been published from this workspace |
| Git repository | Payment switch is reviewed through `feat/flutterwave-payments` into `develop` before promotion to `main` |

## API coverage

The tests run actual NestJS HTTP handlers, role/session guards and SQL transactions against the PostgreSQL engine in PGlite. The hosted baseline CI also passed the same suite against a dedicated PostgreSQL 17 service.

Tests cover staff-role escalation rejection, unauthorised reads, submitted price rejection, delivery fee calculation, checkout retry identity, stock limits, one-time cancellation release, cash permissions/bounds/idempotency, pending-payment cancellation restrictions, duplicate/forged callbacks, independent MoMo settlement matching, custom quotation/assignment/measurements/deposit/fitting/balance, delivery reassignment and recipient codes, staff appointment collisions, refund review/limits/reference, competing checkouts for the last piece, invalid image uploads, account deletion, one-time email verification, production verification gate, password reset/session revocation, refresh rotation, role/deactivation revocation, report totals and audit records.

The workflow suite uses controlled Flutterwave and legacy MTN doubles. Separate adapter tests exercise authenticated v3 charge/verification request contracts, response parsing, redirect validation, test/live credential matching, mode changes and webhook secrets using HTTP fixtures. Workflow tests cover independent matching of reference, amount, currency, payer and transaction ID; duplicate settlement; lost-response handling without another charge; cash blocking during uncertainty; provider declines; and historical MTN reconciliation. These checks do not establish provider uptime, merchant approval or live settlement. Those require the merchant validation described in `LAUNCH.md`. The SMTP outbox worker, reservation-expiry worker and Cloudinary upload path also require deployment acceptance checks with real services.

Native PostgreSQL runs one additional regression test for background polling: a backlog of unavailable legacy MTN payments must not prevent new Flutterwave payments from being checked. This test needs real advisory locks and nested database connections, so it is skipped in PGlite. The local result is 32 passed and one skipped; hosted PostgreSQL CI exercises all 33 tests.

Local Flutter tooling was blocked by automatic approval review after it attempted cloud-instance metadata access. The repository's existing hosted CI provides frontend and native verification. CI uploads the resolved Flutter dependency lock alongside its build checks to support reproducible dependency review.

## Layout previews

`preview-desktop.png` and `preview-mobile.png` are rendered from the Flutter widget tree using embedded fonts and clearly marked sample products. They are layout previews, not browser or physical-device screenshots. Flutter tests check for layout exceptions/overflows. Browser runtime coverage remains an explicit launch item.

## Build choices

The reproducible SDK is Flutter 3.35.4 / Dart 3.9.2. The tested release uses `--no-tree-shake-icons` because the SDK's icon constant finder failed on this environment's generated kernel data. Keeping the icons increases asset size without changing functionality. The secure-storage web implementation in the pinned dependency set does not support Flutter WebAssembly compilation, so the delivered web build intentionally uses JavaScript/CanvasKit. CanvasKit resources and application fonts are hosted with the app.

The package has Android SDK 36 / Java 17 configuration and iOS 13+ source configuration. Hosted baseline CI compiled both native targets. Android CI review output is debug-signed; iOS output is unsigned. Production signing and store acceptance remain separate launch items.

## Business launch boundaries

Real shop information, products, images, prices, policies, tax instructions, merchant credentials, HTTPS hosting, mobile signing and physical-device acceptance are pending. Operational lists have explicit limits documented in `BUSINESS_RULES.md`. Automatic refund transfers, fiscal EBM integration and other excluded capabilities are documented there and are not claimed as implemented.

### Flutterwave settlement verification

The API verifies the provider outcome using the merchant secret key and the payment's unique `tx_ref`. A successful result must have the exact reference, exact expected amount, expected currency, and a nonempty provider transaction ID. Flutterwave customer-profile phone/email are descriptive fields, not settlement identifiers; missing or different profile contacts do not reject an otherwise verified payment. Legacy MTN payments retain their existing phone check.

True mismatches stay pending and report only the field names (reference, amount, currency, transactionId), never raw provider values or personal data. The read-only `node dist/check-payments.js` diagnostic uses the same checks and includes `mismatchFields`. After deployment, existing pending payments are rechecked by the 30-second worker or the customer's **Check payment** button. Neither path sends another charge.

Reference: https://developer.flutterwave.com/docs/transaction-verification
