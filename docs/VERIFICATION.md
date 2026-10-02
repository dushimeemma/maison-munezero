# Verification record

Prepared on 2 October 2026.

| Check | Result / boundary |
| --- | --- |
| NestJS TypeScript compilation | Passed |
| API workflow suite | 17 tests passed, including public health/revision and database outage handling |
| Deployment and release automation suite | 26 tests passed: failure gates, revision matching, provider errors, packaging, reproducible release assets, publication ordering, retries, pagination and tag/asset conflicts |
| GitHub Actions workflow lint | Passed with actionlint 1.7.12; YAML/JSON structure and deployment dependencies checked |
| Production npm dependency audit | 0 known vulnerabilities reported at verification time |
| Flutter static analysis | Passed, no issues |
| Flutter UI tests | 4 tests passed, including mobile/desktop layout, staff navigation and password visibility |
| Flutter release web compilation | Passed in JavaScript/CanvasKit mode, with icon shrinking disabled |
| Browser runtime smoke test | Not completed: the execution environment prevents Chromium's process/socket startup |
| Native Android compilation / device testing | Hosted baseline CI built the debug-signed review APK; physical-device testing is pending |
| Native iOS compilation / device testing | Hosted baseline CI compiled the unsigned iOS release; signing and device testing are pending |
| Docker build / deployment | Hosted baseline CI built the API container; live deployment is pending |
| Live MTN, SMTP and Cloudinary transactions | Not performed; real merchant/service credentials were not provided |
| Live Render/Vercel deployment | Not executed; service setup and deployment secrets are pending |
| GitHub Actions execution | All five baseline verification jobs passed in [run 36998158035](https://github.com/dushimeemma/maison-munezero/actions/runs/36998158035), commit `79c1bb079e08434695a76f8f18cc6346e12bd931`; refer to the release PR for checks on the new configuration |
| Production GitHub Release publication | Provider-double tests passed; no live production release has been published from this workspace |
| Git repository | Application is on `develop`; release configuration is reviewed through `feat/production-releases` into `develop` before promotion to `main` |

## API coverage

The tests run actual NestJS HTTP handlers, role/session guards and SQL transactions against the PostgreSQL engine in PGlite. The hosted baseline CI also passed the same suite against a dedicated PostgreSQL 17 service.

Tests cover staff-role escalation rejection, unauthorised reads, submitted price rejection, delivery fee calculation, checkout retry identity, stock limits, one-time cancellation release, cash permissions/bounds/idempotency, pending-payment cancellation restrictions, duplicate/forged callbacks, independent MoMo settlement matching, custom quotation/assignment/measurements/deposit/fitting/balance, delivery reassignment and recipient codes, staff appointment collisions, refund review/limits/reference, competing checkouts for the last piece, invalid image uploads, account deletion, one-time email verification, production verification gate, password reset/session revocation, refresh rotation, role/deactivation revocation, report totals and audit records.

MoMo is a controlled provider test double in the API suite. It proves application state handling, not MTN network acceptance, live merchant settlement or outage behaviour. Those require the merchant validation described in `LAUNCH.md`. The SMTP outbox worker, reservation-expiry worker and Cloudinary upload path also require deployment acceptance checks with real services.

## Layout previews

`preview-desktop.png` and `preview-mobile.png` are rendered from the Flutter widget tree using embedded fonts and clearly marked sample products. They are layout previews, not browser or physical-device screenshots. Flutter tests check for layout exceptions/overflows. Browser runtime coverage remains an explicit launch item.

## Build choices

The reproducible SDK is Flutter 3.35.4 / Dart 3.9.2. The tested release uses `--no-tree-shake-icons` because the SDK's icon constant finder failed on this environment's generated kernel data. Keeping the icons increases asset size without changing functionality. The secure-storage web implementation in the pinned dependency set does not support Flutter WebAssembly compilation, so the delivered web build intentionally uses JavaScript/CanvasKit. CanvasKit resources and application fonts are hosted with the app.

The package has Android SDK 36 / Java 17 configuration and iOS 13+ source configuration. Hosted baseline CI compiled both native targets. Android CI review output is debug-signed; iOS output is unsigned. Production signing and store acceptance remain separate launch items.

## Business launch boundaries

Real shop information, products, images, prices, policies, tax instructions, merchant credentials, HTTPS hosting, mobile signing and physical-device acceptance are pending. Operational lists have explicit limits documented in `BUSINESS_RULES.md`. Automatic refund transfers, fiscal EBM integration and other excluded capabilities are documented there and are not claimed as implemented.
