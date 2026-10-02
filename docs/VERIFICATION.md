# Verification record

Prepared on 2 October 2026.

| Check | Result / boundary |
| --- | --- |
| NestJS TypeScript compilation | Passed |
| API workflow suite | 17 tests passed, including public health/revision and database outage handling |
| Deployment automation suite | 10 tests passed: failure gates, commit matching, provider errors, finite polling and Vercel packaging |
| GitHub Actions workflow lint | Passed with actionlint 1.7.12; YAML/JSON structure and deployment dependencies checked |
| Production npm dependency audit | 0 known vulnerabilities reported at verification time |
| Flutter static analysis | Passed, no issues |
| Flutter UI tests | 4 tests passed, including mobile/desktop layout, staff navigation and password visibility |
| Flutter release web compilation | Passed in JavaScript/CanvasKit mode, with icon shrinking disabled |
| Browser runtime smoke test | Not completed: the execution environment prevents Chromium's process/socket startup |
| Native Android compilation / device testing | Not run locally; CI job included |
| Native iOS compilation / device testing | Not run locally; unsigned CI job included; signing requires macOS/Apple account |
| Docker deployment | Configuration syntax checked; Docker is not installed in this workspace |
| Live MTN, SMTP and Cloudinary transactions | Not performed; real merchant/service credentials were not provided |
| Live Render/Vercel deployment | Not executed; service setup and deployment secrets are pending |
| GitHub Actions execution | Refer to the pull request checks for current remote build results; local verification does not establish a successful hosted CI run |
| Git repository | Application and CI/CD configuration use `feat/monorepo-cicd` in `dushimeemma/maison-munezero`; review and merge through the pull request |

## API coverage

The tests run actual NestJS HTTP handlers, role/session guards and SQL transactions against the PostgreSQL engine in PGlite. The CI workflow runs the same suite against a dedicated PostgreSQL 17 service; that external CI run has not been executed from this workspace.

Tests cover staff-role escalation rejection, unauthorised reads, submitted price rejection, delivery fee calculation, checkout retry identity, stock limits, one-time cancellation release, cash permissions/bounds/idempotency, pending-payment cancellation restrictions, duplicate/forged callbacks, independent MoMo settlement matching, custom quotation/assignment/measurements/deposit/fitting/balance, delivery reassignment and recipient codes, staff appointment collisions, refund review/limits/reference, competing checkouts for the last piece, invalid image uploads, account deletion, one-time email verification, production verification gate, password reset/session revocation, refresh rotation, role/deactivation revocation, report totals and audit records.

MoMo is a controlled provider test double in the API suite. It proves application state handling, not MTN network acceptance, live merchant settlement or outage behaviour. Those require the merchant validation described in `LAUNCH.md`. The SMTP outbox worker, reservation-expiry worker and Cloudinary upload path also require deployment acceptance checks with real services.

## Layout previews

`preview-desktop.png` and `preview-mobile.png` are rendered from the Flutter widget tree using embedded fonts and clearly marked sample products. They are layout previews, not browser or physical-device screenshots. Flutter tests check for layout exceptions/overflows. Browser runtime coverage remains an explicit launch item.

## Build choices

The reproducible SDK is Flutter 3.35.4 / Dart 3.9.2. The tested release uses `--no-tree-shake-icons` because the SDK's icon constant finder failed on this environment's generated kernel data. Keeping the icons increases asset size without changing functionality. The secure-storage web implementation in the pinned dependency set does not support Flutter WebAssembly compilation, so the delivered web build intentionally uses JavaScript/CanvasKit. CanvasKit resources and application fonts are hosted with the app.

The package has Android SDK 36 / Java 17 configuration and iOS 13+ source configuration. Neither mobile binary is represented as successfully built or signed. Android CI review output is debug-signed; production signing is guarded separately.

## Business launch boundaries

Real shop information, products, images, prices, policies, tax instructions, merchant credentials, HTTPS hosting, mobile signing and physical-device acceptance are pending. Operational lists have explicit limits documented in `BUSINESS_RULES.md`. Automatic refund transfers, fiscal EBM integration and other excluded capabilities are documented there and are not claimed as implemented.
