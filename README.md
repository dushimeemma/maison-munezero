# Maison Munezero

Flutter web, Android and iOS application, backed by a NestJS API and PostgreSQL. The same app provides the customer store and staff workspaces; permissions are enforced on the server. This is a monorepo: `apps/flutter` and `apps/api` share version history, build commands and the delivery pipeline.

**Delivery status:** implemented source with automated checks and a release web build. This is ready for business review and deployment configuration, not a claim that a live shop or store-signed mobile apps have been launched. Live Flutterwave merchant approval and credentials, real catalogue data, hosting, mobile signing and device acceptance tests are still required. See `docs/LAUNCH.md` and `docs/VERIFICATION.md` for the precise boundaries.

The Instagram reference could not be retrieved reliably. Products, prices, garment illustrations and the initial shop address are sample data, not verified Maison Munezero inventory or policies. Replace them through the workspace before launch. No Instagram assets have been copied.

## Included flows

- Browse and search products, dynamic categories, size/colour variants, available stock, wishlist and shopping bag.
- Customer registration, sign-in, rotating sessions, email verification, password recovery, logout and account deletion.
- Online checkout with delivery zones or shop pickup; server calculates price, tax and delivery before payment.
- Walk-in shop sales through authorised sales staff; cash receipt recording and Flutterwave mobile-money requests for MTN/Airtel wallets.
- Order receipts as printable/downloadable PDF; these are not EBM fiscal invoices.
- Bespoke request, designer/tailor assignment, quotation, customer acceptance, configurable deposit, measurements, production, fittings, balance payment and collection/delivery.
- Consultation, measurement, fitting and collection appointments, with staff confirmation and overlap checks.
- Driver assignment/reassignment, dispatch, failure reporting and recipient-code confirmation.
- Inventory adjustments with reasons, product image uploads through Cloudinary, product publication and price management.
- Return requests, finance review and externally verified refund records.
- In-app notifications, HTTPS/SMTP email outbox/retry worker, financial summaries, low stock and audit history.
- Docker setup, PostgreSQL migrations, environment examples and GitHub CI/CD: verification, Render API deployment, Vercel web publication and production GitHub Releases, plus Android review and unsigned iOS builds.

## Monorepo and CI/CD

From the repository root, install both app toolchains and verify:

```bash
npm run api:install
npm run flutter:install
npm run verify
```

Feature branches target `develop`; reviewed changes are promoted from `develop` to `main`. All checks gate production deployment on `main`: the API deploys to Render first, then its health/revision check gates publication of the compiled Flutter website to Vercel. CD is activated with `CD_ENABLED=true` after the required GitHub variables/secrets and service credentials are configured.

After both production deployments pass, Actions publishes a GitHub Release tagged to that exact commit, with categorized change notes, the deployed web bundle, deployment metadata and SHA-256 checksums. Tags use the shared application version plus the workflow build number, for example `v1.0.0+deploy.12`. PRs and `develop` builds do not publish releases. See the release and retry instructions in the CI/CD guide.

See **[docs/CI_CD.md](docs/CI_CD.md)** for the complete setup, exact settings, migration strategy and rollback instructions. GitHub repository: [dushimeemma/maison-munezero](https://github.com/dushimeemma/maison-munezero). Service projects and deployment credentials require the setup described in the guide.

## Roles

| Role | Main access |
| --- | --- |
| Super admin | Full operations; create staff accounts, change access, audit history |
| Manager | Catalogue, inventory, orders, team assignments, appointments, reports and settings |
| Sales | Shop checkout, orders, cash recording and product/delivery visibility |
| Designer | Assigned custom requests, quotes, measurements and production/fitting updates |
| Tailor | Assigned tailoring jobs, measurements and production/fitting updates |
| Driver | Assigned deliveries; pickup, failure and recipient-code completion |
| Accountant | Payments, reconciliation, return/refund review and reports |
| Customer | Own orders, designs, appointments, returns, wishlist and profile |

## Quick start with Docker

Install Docker, Node 24 and Flutter 3.35.4 (the tested SDK). Android development also needs Java 17 and Android SDK 36. iOS builds need macOS and Xcode.

1. Copy `.env.example` to `.env` and set a strong `POSTGRES_PASSWORD`, `ADMIN_EMAIL` and `ADMIN_PASSWORD` (at least 12 characters). Use a URL-safe PostgreSQL password in the Compose connection string. Keep `NODE_ENV=development` and sample data enabled for review only.
2. Start the database and build the API:

```bash
docker compose up -d db
docker compose build api
docker compose run --rm api node dist/migrate.js
docker compose run --rm api node dist/seed.js
docker compose up -d api
```

3. Run the Flutter web client:

```bash
cd apps/flutter
flutter pub get
flutter run -d chrome --web-port=8080 --dart-define=API_BASE_URL=http://localhost:3000/api/v1
```

Open the app, sign in using the admin account you configured, open Workspace → Users and create staff accounts. Customers register through Sign in → Create account.

Mobile-money payment is disabled until Flutterwave v3 credentials are configured. Start with `FLUTTERWAVE_MODE=test` and your v3 test secret key; see `docs/LAUNCH.md` for the confirmation-page and webhook setup. The shop cash flow can be reviewed without payment-provider credentials. Email verification, password recovery and order notifications use the email outbox. Configure Brevo HTTPS on Render Free or SMTP locally; see `docs/EMAIL.md`. Image uploads need Cloudinary settings; in-app notifications work without email configuration.

## Release web build and container

From `apps/flutter`:

```bash
flutter build web --release --no-tree-shake-icons --no-web-resources-cdn --dart-define=API_BASE_URL=/api/v1
```

Then from the repository root:

```bash
docker compose -f docker-compose.yml -f docker-compose.web.yml up -d --build
```

The review server binds to `http://localhost:8080`. The web container proxies `/api/v1` to the API. Add HTTPS at your trusted reverse proxy/load balancer for a real deployment. The compiled client must be rebuilt when `API_BASE_URL` changes. HTTPS is required for web token storage outside localhost.

## Local API without Docker

Use an existing PostgreSQL database, then:

```bash
cd apps/api
cp .env.example .env
# Fill DATABASE_URL and the admin settings in .env.
npm ci
npm run migrate
npm run seed
npm run dev
```

Health check: `GET http://localhost:3000/api/v1/health`.

## Android review and production

Use your deployed HTTPS API for a real device. Android emulators can use `http://10.0.2.2:3000/api/v1` for debug development; production builds use HTTPS.

```bash
cd apps/flutter
flutter run --dart-define=API_BASE_URL=https://YOUR_API_DOMAIN/api/v1
```

For a **local review APK** on Bash/macOS/Linux only:

```bash
ORG_GRADLE_PROJECT_reviewBuild=true flutter build apk --release --no-tree-shake-icons --dart-define=API_BASE_URL=https://YOUR_API_DOMAIN/api/v1
```

PowerShell equivalent:

```powershell
$env:ORG_GRADLE_PROJECT_reviewBuild="true"
flutter build apk --release --no-tree-shake-icons --dart-define=API_BASE_URL=https://YOUR_API_DOMAIN/api/v1
Remove-Item Env:ORG_GRADLE_PROJECT_reviewBuild
```

The review APK is debug-signed and must not be uploaded to Google Play. Production release builds require your upload keystore and `apps/flutter/android/key.properties` (example in `deploy`). With signing configured:

```bash
flutter build appbundle --release --no-tree-shake-icons --dart-define=API_BASE_URL=https://YOUR_API_DOMAIN/api/v1
```

## iOS

On a Mac:

```bash
cd apps/flutter
flutter pub get
cd ios
pod install
cd ..
open ios/Runner.xcworkspace
```

Set your Apple team and approved bundle identifier in Xcode. Use your HTTPS API and run:

```bash
flutter build ipa --release --no-tree-shake-icons --dart-define=API_BASE_URL=https://YOUR_API_DOMAIN/api/v1
```

This package contains iOS source/configuration, not a signed IPA. Distribution requires your Apple developer account and provisioning.

## Tests

Verification evidence and platform limitations are recorded in `docs/VERIFICATION.md`. Desktop/mobile layout previews are included in `docs`.

```bash
cd apps/api
npm ci
npm test
npm audit --omit=dev
```

Without `TEST_DATABASE_URL`, tests use the PostgreSQL engine in PGlite. CI also runs against PostgreSQL 17. **Never point `TEST_DATABASE_URL` at a real business database: the test harness recreates its public schema.**

```bash
cd apps/flutter
flutter pub get
flutter analyze
flutter test
```

## Project map

```text
apps/api/src/          Authentication, roles, catalogue, orders, payments, atelier, operations
apps/api/migrations/   Versioned PostgreSQL schema
apps/api/test/         API workflow tests and isolated local preview server
apps/flutter/lib/     Storefront, customer flows, staff workspace and receipt/image helpers
apps/flutter/android/ Native Android project and release signing guard
apps/flutter/ios/     Native iOS project, permissions and Keychain entitlements
apps/flutter/web/     Web shell and installable web manifest
deploy/               Nginx and deployment examples
docs/                 Business rules, API contract, launch steps and verification evidence
.github/workflows/    Pull request and branch checks
scripts/              Shared commands, Vercel packaging, Render deployment and pipeline tests
render.yaml           API service configuration with pre-deploy migrations
vercel.json           Website project configuration; Actions owns deployment
```

Do not commit `.env`, passwords, signing keys, SMTP secrets or payment-provider credentials. No external repository, live payment account, domain or app-store listing was created by this delivery.
