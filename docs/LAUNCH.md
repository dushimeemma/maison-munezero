# Configuration and launch

## Merchant and business setup

Replace sample products/illustrations/prices and the shop address. Confirm the shop phone/email, delivery areas/fees, deposit percentage, quotation conditions, returns rules and tax settings in Workspace → Settings. Use your business accountant's tax instructions. Remove the sample-catalogue notice only after replacing sample data.

Provide a business-owned privacy policy, support contact and terms suitable for the actual operation, including custom garments and retained transaction records. The source includes account deletion; its retention behaviour is documented in `BUSINESS_RULES.md`. This document is a deployment guide, not a legal compliance certification.

## MTN MoMo

Configure the Collection API subscription key, API user and API key on the API server. Never put these values in Flutter `--dart-define`, the mobile app or a Git repository.

Sandbox:

```dotenv
MOMO_BASE_URL=https://sandbox.momodeveloper.mtn.com
MOMO_TARGET_ENVIRONMENT=sandbox
MOMO_SUBSCRIPTION_KEY=YOUR_SANDBOX_COLLECTION_KEY
MOMO_API_USER=YOUR_SANDBOX_API_USER
MOMO_API_KEY=YOUR_SANDBOX_API_KEY
MOMO_CALLBACK_BASE=https://YOUR_PUBLIC_API_HOST
```

The sandbox uses EUR as a test currency. No exchange conversion is performed. Use test payer numbers and outcomes approved by MTN; sandbox does not prove live RWF settlement.

Production, after merchant approval:

```dotenv
NODE_ENV=production
MOMO_BASE_URL=https://proxy.momoapi.mtn.com
MOMO_TARGET_ENVIRONMENT=mtnrwanda
MOMO_SUBSCRIPTION_KEY=YOUR_PRODUCTION_COLLECTION_KEY
MOMO_API_USER=YOUR_PRODUCTION_API_USER
MOMO_API_KEY=YOUR_PRODUCTION_API_KEY
MOMO_CALLBACK_BASE=https://YOUR_PUBLIC_API_HOST
CORS_ORIGINS=https://YOUR_WEB_HOST
```

Confirm the endpoint, target environment, currency, callback-host registration, account settlement and merchant onboarding with MTN Rwanda for the actual contract. The listed production endpoint is MTN's published general endpoint, not evidence of Maison Munezero's approval. Callbacks are complemented by status polling; callback data alone is never used to mark an order paid.

Before launch, test live small-value transactions, payer refusal, timeout, duplicate callback, API restart after submission and reconciliation against the merchant statement. Do not begin a second payment while one is pending. The application never requests or stores a MoMo PIN.

MTN primary references:

- https://momodeveloper.mtn.com/get-started
- https://momodeveloper.mtn.com/api-documentation
- https://momodeveloper.mtn.com/content/html_widgets/v98wn.html
- https://momodeveloper.mtn.com/content/html_widgets/uv7jo.html
- https://momodeveloper.mtn.com/content/html_widgets/1vu7v.html
- https://momodevelopercommunity.mtn.com/how-to-59/momo-api-production-configuration-101

## Email and media

Configure SMTP host, port, user/password and a verified `SMTP_FROM`. Port 587 typically uses STARTTLS with `SMTP_SECURE=false`; port 465 typically uses `true`. Confirm the provider's required settings. Test real password recovery and transactional messages. The worker retries queued messages; in-app notifications remain available even if email fails.

For Cloudinary uploads configure `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY` and `CLOUDINARY_API_SECRET` on the API. Staff can upload an image through the product editor. Hosted HTTPS image links also work. Upload accepts JPEG, PNG and WebP up to 5 MB. Images use `maison-munezero` folder. Old/unreferenced uploads are not automatically deleted; manage storage retention in Cloudinary. Design requests support a reference-image URL; a customer upload endpoint exists but an in-app picker for new design requests is not included.

## Infrastructure

Use a managed PostgreSQL database or persistent PostgreSQL volume, private networking, backups and tested restores. Run `node dist/migrate.js` as a release step before new API instances start. Run seed only to create the initial admin; `SEED_SAMPLE_DATA=false` for production. Seed does not overwrite an existing user's password.

Terminate TLS at a trusted load balancer/reverse proxy. Use the provided Nginx rate limits or equivalent edge controls; direct production exposure of the API without those controls is outside this deployment configuration. Configure trusted proxy/client-address handling at your ingress so rate limiting uses the real client safely. Tighten CORS to the real HTTPS website. Use database certificate verification for a remote database (`DB_SSL=true`); the local Compose network uses `false`.

Enable process restarts, API health monitoring and alerts for pending payments, worker failures, unsent email, database outages and failed refunds/reconciliation. The app's workers use database locks for replica coordination; SMTP is at least once. Retain and rotate audit/database records according to the business policy. Large lists currently have explicit limits; scale reporting/export/pagination before supporting a large multi-branch business.

## Mobile and CI

Use `CI_CD.md` for monorepo/GitHub configuration and the Render backend / Vercel frontend deployment pipeline. Both deployment jobs wait for all checks, use the verified commit, and are enabled only after setting `CD_ENABLED=true` with the documented credentials. GitHub Actions owns deployments; service Git auto-deployment is disabled to avoid bypassing the test gate.

Set GitHub repository variable `API_BASE_URL` to the real HTTPS API base path. CI runs API tests against a dedicated PostgreSQL 17 service, Flutter analysis/tests, a release web build, an Android review APK and an unsigned iOS build.

The Android review artifact is debug-signed and not a Play Store upload. Create a business-owned upload keystore and `android/key.properties` for production. The Gradle configuration prevents accidentally building a debug-signed production release unless explicitly opting into review mode. Keep signing files out of Git.

Use the business Apple team, provisioning and app identifiers for iOS. Validate image picker, Keychain, receipt printing, login refresh and network recovery on physical iOS/Android devices. App-store listing, required declarations, screenshots, privacy review and developer accounts remain business release tasks. Neither store submission nor native compilation happened in this Linux workspace.

Flutter release references:

- https://docs.flutter.dev/deployment/android
- https://docs.flutter.dev/deployment/ios
- https://docs.flutter.dev/deployment/web

## Acceptance scenarios

Review a real shop sale, paid delivery, failed delivery/reassignment, customer pickup code, out-of-stock checkout, custom quotation/deposit/fitting/balance, concurrent appointment booking, failed/pending MoMo, return/refund record, stock adjustment, password reset, role change and account deletion. Confirm receipts against actual cash/MoMo records and the separate fiscal invoicing process.

The printed order receipt is not an RRA EBM invoice. Integrate the business's approved EBM/fiscal invoicing system separately if required for its operations.
