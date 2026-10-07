# Configuration and launch

## Merchant and business setup

Replace sample products/illustrations/prices and the shop address. Confirm the shop phone/email, delivery areas/fees, deposit percentage, quotation conditions, returns rules and tax settings in Workspace → Settings. Use your business accountant's tax instructions. Remove the sample-catalogue notice only after replacing sample data.

Provide a business-owned privacy policy, support contact and terms suitable for the actual operation, including custom garments and retained transaction records. The source includes account deletion; its retention behaviour is documented in `BUSINESS_RULES.md`. This document is a deployment guide, not a legal compliance certification.

## Flutterwave mobile money

New payments use Flutterwave's **v3 Rwanda mobile-money charge API** in RWF, supporting MTN MoMo and Airtel Money. Create a Rwanda business account and confirm collection activation, fees and settlement arrangements with Flutterwave. Live merchant approval is separate from installing this code. This integration requires a **v3 secret key**, not a v4 OAuth client secret; never put it in Flutter, `--dart-define` or Git.

For local testing, obtain the v3 secret key from the dashboard in **Test Mode** and set these values in the root `.env` for Docker, or `apps/api/.env` for the local Node server:

```dotenv
FLUTTERWAVE_MODE=test
FLUTTERWAVE_SECRET_KEY=YOUR_V3_TEST_SECRET_KEY
FLUTTERWAVE_WEBHOOK_SECRET=YOUR_RANDOM_SECRET_OF_AT_LEAST_32_CHARACTERS
```

The test secret key starts with `FLWSECK_TEST-`. Both test and live requests use `https://api.flutterwave.com/v3` and RWF. The API rejects mismatched keys/modes; production startup also rejects test mode. Use test orders separately from the live shop: successful test transactions update test order records but do not collect real money. Flutterwave documents automatic authorization of Rwanda mobile-money test payments after a few seconds on its confirmation page.

After changing Docker environment values or updating this branch:

```bash
docker compose build api
docker compose run --rm api node dist/migrate.js
docker compose up -d --force-recreate api
```

Keep the database volume. Migration `002_flutterwave_payments.sql` preserves existing payments and adds Flutterwave records, authorization URLs, payer snapshots and an independent test-mode flag.

In the Flutterwave dashboard, configure the webhook URL as `https://YOUR_PUBLIC_API_HOST/api/v1/payments/flutterwave/webhook`, set its secret hash to the same `FLUTTERWAVE_WEBHOOK_SECRET`, and enable webhook retries. The v3 `verif-hash` header is checked using a constant-time comparison. The posted status/amount is never accepted as financial truth: the server calls the authenticated verification API by its stored `tx_ref`, checks reference, exact amount, currency and payer, then settles once under database locks. Polling every 30 seconds and the customer's **Check payment** button also work when webhooks cannot reach a local server.

Checkout: choose **Pay with mobile money**, enter a Rwanda wallet number in `2507XXXXXXXX` format, choose due/deposit or full balance, and tap **Request payment**. After the form closes, tap **Continue payment** in the order's Payment section. That button appears only when a confirmation link was received. A separate browser tab opens on web; iOS/Android open the system browser. Complete the confirmation page, approve your wallet's prompt when using live mode, return to the app and tap **Check payment**. The application never asks for a wallet PIN. Reopening the confirmation page does not create another charge. Allow the website to open the confirmation tab if your browser blocks it.

The email and customer name are snapshotted from the order's customer account. Walk-in orders without an attached customer use the sales account's email for the required provider contact field; attach a customer account when their own email should receive provider communications.

Live configuration, **after merchant approval**:

```dotenv
NODE_ENV=production
FLUTTERWAVE_MODE=live
FLUTTERWAVE_SECRET_KEY=YOUR_V3_LIVE_SECRET_KEY
FLUTTERWAVE_WEBHOOK_SECRET=YOUR_RANDOM_SECRET_OF_AT_LEAST_32_CHARACTERS
CORS_ORIGINS=https://YOUR_WEB_HOST
```

If submission times out, do not create another payment, switch providers, or collect cash for that order. Flutterwave requests are not automatically resubmitted after uncertain submission: absence from verification can be temporary. Keep the order pending, verify by reference and investigate through the merchant dashboard/support. Release a pending payment only after confirming its final outcome; do not change payment rows merely to remove a pending warning. The app does not implement an automatic cross-provider fallback.

### Missing confirmation link or uncertain request

`PENDING / UNCERTAIN` without an authorization URL means the server did not record a usable confirmation response. It does not establish whether Flutterwave accepted the charge. The original implementation stored a generic reconciliation message, so older requests cannot recover their original submission error from that message.

After pulling this branch, rebuild and recreate the API, then inspect the existing requests:

```bash
git pull --ff-only
docker compose build api
docker compose up -d --force-recreate api
docker compose exec api node dist/check-payments.js
```

This command reads the latest five pending Flutterwave requests and performs only authenticated **GET** verification by their stored reference. PostgreSQL enforces a read-only transaction; no payment is submitted, retried or updated. It prints internal payment references, mode/configuration booleans and fixed diagnostic codes, without secret keys, payer contacts, confirmation URLs or raw provider bodies. A successful verification still needs the app's **Check payment** or its background worker to apply settlement after validating the stored payment.

| Diagnostic | Next action |
| --- | --- |
| `matchingV3KeyConfigured: false` | Configure a matching v3 key and `test`/`live` mode in the API environment, then recreate the API. |
| `AUTHENTICATION`, HTTP 401 | Check the v3 secret key in the Flutterwave dashboard for this environment; this reports the current verification failure. |
| `ACCESS_DENIED`, HTTP 403 | Ask Flutterwave to confirm merchant permissions for the operation. |
| `MODE_MISMATCH` | Verify with the original payment's mode and credentials. |
| `NETWORK`, `RATE_LIMITED`, `PROVIDER_UNAVAILABLE` | Keep the request pending and repeat verification when connectivity/provider service recovers. |
| `NOT_FOUND_OR_NOT_YET_AVAILABLE` | Check the stored reference in the merchant dashboard/support. Absence does not prove that a timed-out charge failed. |
| `matchesStoredPayment: false` | Merchant review is required; the app must not credit this result. |

Future uncertain submissions retain a fixed diagnostic message in the Payment section and emit a `PAYMENT_SUBMISSION_UNCERTAIN` log with payment ID, provider, code and HTTP status. View these logs with `docker compose logs --tail=100 api`. `CONFIRMATION_ADDRESS` also includes a `confirmation.issue` (`MISSING_ADDRESS`, `MALFORMED_ADDRESS`, `INSECURE_SCHEME`, `URL_CREDENTIALS`, `CUSTOM_PORT` or `UNSUPPORTED_HOST`) and, when safe, the public hostname. Paths, query tokens, URL credentials and sensitive values are excluded. `CONFIRMATION_MISSING` identifies a missing handoff response; do not invent a confirmation URL or replay the charge. The diagnostic command checks current verification and cannot reconstruct an earlier submission error. Do not clear pending rows or reset the database to enable another attempt.

The provider handoff accepts HTTPS URLs on `flutterwave.com` and its subdomains, including `ravesandboxapi.flutterwave.com`, as well as the exact legacy `ravemodal-dev.herokuapp.com` hostname published in the Rwanda examples. Stored test payments also accept the exact `checkout-v2.dev-flutterwave.com` host shown in [Flutterwave's mobile-money documentation](https://developer.flutterwave.com/docs/zambia-mobile-money) and observed in Rwanda test charge responses. Live payments reject that test checkout host. Both payment responses and order details apply the same validation using the payment's stored test-mode flag. Similar-looking domains, other `dev-flutterwave.com` hosts, other Heroku apps, embedded URL credentials and nonstandard ports are rejected. V3 authorization metadata may use `redirect` or `redirect_url`. Previously rejected responses were not saved and cannot be restored by updating the validator. With confirmed test mode, use a separate test order once to verify the updated handoff; keep existing uncertain requests for independent reconciliation.

Existing `MOMO` payments continue using their original MTN status API and stored currency. Keep the original `MOMO_*` settings on the server until those payments are reconciled. New requests, including the older `/orders/:id/momo` compatibility route, use Flutterwave. Historical cash payments remain cash. Do not switch test/live credentials with pending transactions from the previous mode; finish reconciliation first or keep separate deployments/databases.

Before launch, validate MTN and Airtel collection with small live amounts, refusal, timeout, repeat callbacks, a restart during submission, deposit/balance and merchant-statement reconciliation. Automated fixtures do not establish provider uptime or live settlement. An aggregator still relies on the underlying wallet networks.

Primary references:

- https://developer.flutterwave.com/docs/rwanda
- https://developer.flutterwave.com/reference/charge-via-rwanda-mobile-money
- https://developer.flutterwave.com/reference/verify-transaction-with-tx_ref
- https://developer.flutterwave.com/docs/webhooks
- https://flutterwave.com/ng/support/onboarding/onboarding-requirements-for-opening-a-business-account-in-rwanda

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
