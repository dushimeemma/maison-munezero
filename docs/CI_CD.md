# Monorepo and delivery pipeline

GitHub repository: [dushimeemma/maison-munezero](https://github.com/dushimeemma/maison-munezero).

## Structure and local commands

One repository contains `apps/api` (NestJS/PostgreSQL) and `apps/flutter`
(customer/staff app for web, Android and iOS). Root scripts coordinate both
toolchains; each app keeps its own dependency lockfile. Flutter is a Dart
project, so it is not represented as an npm workspace.

Use Node 24, Flutter 3.35.4, Java 17 and Android SDK 36. From the repository root:

```bash
npm run api:install
npm run flutter:install
npm run verify
npm run api:dev
```

`FLUTTER_BIN` can specify a Flutter executable outside PATH. Run the app using
the Flutter commands in the main README. For a Docker/proxy web build:

```bash
npm run web:build
```

`API_BASE_URL` defaults to `/api/v1` for local web packaging. Production and
native builds must target the deployed HTTPS API, including `/api/v1`.
Build output, secrets, signing files, dependency folders and machine-specific
Flutter configuration are ignored by Git. Gradle wrapper files are committed.

## Branch flow

Implement changes on a feature branch and open a PR into `main`. `develop` can
also be used for integration checks. PRs and pushes to `main`/`develop` run CI.
Use the five CI jobs as required checks in GitHub branch protection when the
repository is available. This source does not configure GitHub's server-side
branch protection or environment approvals.

| CI job | Checks / output |
| --- | --- |
| Deployment automation tests | Configuration, provider errors, revision matching, finite polling, static web packaging and actionlint workflow validation |
| Backend tests and container build | PostgreSQL 17 workflow suite, dependency audit and production Docker build |
| Frontend checks and web build | Flutter analysis/UI tests, release web build and Vercel output artifact |
| Android review APK | Java 17 / SDK 36; debug-signed review artifact |
| Unsigned iOS build | Native compilation on a macOS runner; no store signing |

All five jobs must succeed before either production deploy job runs. Production
deploys are restricted to `main`, on push or a manual workflow run, with
`CD_ENABLED=true`. PR runs have no deployment credentials. Workflow runs on
`main` are serialized and not canceled during deployment.

## GitHub configuration

Set repository **variables** under Settings → Secrets and variables → Actions:

| Variable | Value |
| --- | --- |
| `CD_ENABLED` | `false` during setup; `true` to enable production CD |
| `API_BASE_URL` | Actual HTTPS API URL ending in `/api/v1` |
| `WEB_SITE_URL` | Public canonical website origin, e.g. `https://maison-munezero.vercel.app` |
| `RENDER_SERVICE_ID` | API service ID beginning with `srv-` |
| `VERCEL_ORG_ID` | Vercel team/account ID for the website |
| `VERCEL_PROJECT_ID` | Vercel website project ID |

Set these **secrets** at repository scope or in the `production` environment:

| Secret | Purpose |
| --- | --- |
| `RENDER_API_KEY` | Render account API key authorized to deploy the configured API service |
| `VERCEL_TOKEN` | Vercel deployment token with access to the configured project |

The workflow creates/uses the `production` environment. Tokens remain in the
job environment; scripts never log their values. MoMo, database, SMTP,
Cloudinary and mobile signing credentials belong on their service/build
platforms, not in Flutter or source code.

CD stays disabled while these values are absent. Enabling it with incomplete
configuration fails the configuration check instead of silently deploying a
placeholder. `API_BASE_URL` is compiled into web/mobile artifacts and must be
configured before building an APK intended for actual review.

## Render backend setup

1. Import the root `render.yaml` from this repository on branch `main`, or create
   an equivalent Docker web service. Dockerfile: `apps/api/Dockerfile`; build
   context: `apps/api`. Keep the service root directory at the repository root.
2. The example selects the paid `0.5c-512mb` compute plan in Frankfurt so
   pre-deploy migrations and the continuous payment/email workers can run.
   Review the plan before importing. No Render resources or billing changes
   have been created by preparing this file.
3. Configure the existing/managed PostgreSQL URL and business credentials
   requested by the Blueprint. It deliberately does not create a database.
   `DB_SSL=true` verifies the certificate for a remote database. A Render
   private-network database connection can use the corresponding documented
   private-network configuration instead. Keep credentials out of Git.
4. Set `CORS_ORIGINS` to the actual website origin, `MOMO_CALLBACK_BASE` to the
   public API origin and all approved live MoMo/SMTP/media values as described
   in `LAUNCH.md`. Production startup rejects incomplete MoMo/SMTP settings.
5. Keep auto-deploy **off**. GitHub Actions triggers the tested commit through
   Render's API, not a deploy hook that selects a newer untested commit.
6. The pre-deploy command `node dist/migrate.js` applies migrations before the
   new instance starts. After initial setup, run `node dist/seed.js` once in
   the Render shell with `SEED_SAMPLE_DATA=false` and your admin settings.
   Admin seeding is not performed on every deployment.

The deployment script waits up to roughly 30 minutes, fails on build/migration/
update errors, verifies Render's deployed commit, and checks the public
`/api/v1/health` response against the same revision. Render injects
`RENDER_GIT_COMMIT`; the health endpoint returns it as `revision`. Self-hosted
deployments may use `APP_REVISION` instead.

## Vercel frontend setup

1. Create/link a website project for this repository. Set Root Directory to the
   **repository root**, Framework Preset to **Other**, and use Node 24.
2. Keep Vercel Git auto-deployment disabled. Root `vercel.json` sets
   `git.deploymentEnabled=false`; Actions supplies the already compiled output.
   Vercel does not need Flutter installed in a remote build container.
3. Get the organization/project IDs from your linked project settings or
   `.vercel/project.json`; store them as GitHub variables. Configure its public
   canonical domain and use that origin for `WEB_SITE_URL` and API CORS.
4. Add the deployment token as `VERCEL_TOKEN`, then set `CD_ENABLED=true` when
   the backend and business launch configuration are ready.

CI compiles Flutter once and packages that exact build using Vercel Build Output
API v3. The deployment job downloads this artifact, pulls project settings and
publishes with pinned Vercel CLI `62.1.0` using `--prebuilt --prod`. Static files
are served before the single-page fallback. Release HTML/assets revalidate to
avoid silently keeping a previous app version.

After deployment, Actions checks the public website HTML, JavaScript response
type and `maison-release.json` commit/API URL. These are HTTP checks, not browser
interaction or device acceptance. Keep browser and real-device checks in the
launch process. Protected production websites need an equivalent authenticated
verification strategy; the configured storefront is intended to be public.

## Failure handling and rollback

If backend deployment fails, frontend publication stops. If frontend publication
fails after the backend succeeds, the previous website remains active; API
changes must remain compatible with that version. Use additive database changes
and test old/new app compatibility before removing columns or endpoints.

Rollback the website through Vercel's deployment history and the API through
Render's deployment history after checking schema compatibility. Database
migrations are not automatically reversed, and customer payments/orders are
not replayed. Resolve the failure and rerun the workflow on the intended commit
after review. Do not bypass failed tests to deploy a different revision.

CI builds Android review artifacts and unsigned iOS output. Play Store/App Store
publishing is not configured because business signing and store accounts are
not provided. Native release instructions remain in the main README.

## Verification boundaries

Local deployment tests use provider doubles and prove the pipeline's decision
logic. They do not prove the acceptance of actual Render/Vercel credentials,
the remote Docker/native builds, GitHub Actions execution or live MoMo. Those
checks become possible after repository/service setup. See `VERIFICATION.md`.

Primary references used for this configuration:

- https://docs.github.com/en/actions/writing-workflows/workflow-syntax-for-github-actions
- https://render.com/docs/blueprint-spec
- https://render.com/docs/environment-variables
- https://api-docs.render.com/reference/create-deploy
- https://api-docs.render.com/reference/retrieve-deploy
- https://vercel.com/docs/build-output-api/configuration
- https://vercel.com/docs/project-configuration/git-configuration
- https://vercel.com/docs/cli
