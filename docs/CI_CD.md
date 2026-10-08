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

Implement changes on a feature branch and open a PR into `develop`. Promote
reviewed integration changes with a separate PR from `develop` into `main`.
PRs and pushes to `main`/`develop` run CI.
Use the five CI jobs as required checks in GitHub branch protection when the
repository is available. This source does not configure GitHub's server-side
branch protection or environment approvals.

| CI job | Checks / output |
| --- | --- |
| Deployment automation tests | Configuration, provider errors, revision matching, finite polling, web packaging, release safety/retries and actionlint workflow validation |
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
job environment; scripts never log their values. Flutterwave, database, SMTP,
Cloudinary and mobile signing credentials belong on their service/build
platforms, not in Flutter or source code.

CD stays disabled while these values are absent. Enabling it with incomplete
configuration fails the configuration check instead of silently deploying a
placeholder. `API_BASE_URL` is compiled into web/mobile artifacts and must be
configured before building an APK intended for actual review.

## Render backend setup

For hosted review with Flutterwave test credentials, follow
[`SANDBOX_DEPLOYMENT.md`](SANDBOX_DEPLOYMENT.md) and use
`render.sandbox.yaml`. The production settings below require live credentials.

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
4. Set `CORS_ORIGINS` to the actual website origin, `FLUTTERWAVE_MODE=live`,
   the approved v3 secret key and webhook secret, and SMTP/media values as
   described in `LAUNCH.md`. Register the public webhook URL in Flutterwave.
   Production startup rejects test mode, mismatched keys and incomplete
   Flutterwave/SMTP settings. Retain `MOMO_*` values only while legacy payments
   still require reconciliation.
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

## Production GitHub Releases

The `release` job in `.github/workflows/ci.yml` depends on successful backend
and frontend deployment jobs, including their public revision/health checks.
It runs only for a `main` push or manual workflow run with `CD_ENABLED=true`.
Failed/skipped deployments, PRs and `develop` builds cannot publish a release.
The downloaded web artifact must identify the same full commit and API URL.

The release job alone receives `contents: write`; verification and deployment
jobs keep `contents: read`. It uses the automatic `GITHUB_TOKEN`, so no new
release token secret is required. Tag protection, if enabled separately, must
allow the workflow to create production tags.

Tags have the form `v<application-version>+deploy.<workflow-run-number>`, for
example `v1.0.0+deploy.12`. The suffix is semantic-version build metadata, not a
beta version. Each new production workflow run gets its own tag. A retry of
the same run keeps the tag, and tags always point to the tested `GITHUB_SHA`.
Existing tags are never moved to another commit.

Before changing the application version, update these files together:

- Root `package.json` and `package-lock.json`.
- `apps/api/package.json` and `apps/api/package-lock.json`.
- `apps/flutter/pubspec.yaml`: the same semantic version, with a separately
  incremented mobile build number, e.g. `1.1.0+2`.

The automation suite rejects mismatched or prerelease application versions
before deployment. Releases do not write version bumps back to source.

Each release contains:

| Asset | Contents |
| --- | --- |
| `maison-munezero-web.zip` | The deployed Vercel Build Output API v3 package (`config.json` and `static/`), downloaded from this workflow without recompiling Flutter |
| `deployment.json` | Full commit, shared application version, workflow run URL, Render deployment ID, canonical API/website URLs and Vercel deployment URL |
| `SHA256SUMS` | SHA-256 hashes of the web ZIP and deployment manifest |
| GitHub source archives | Source at the exact tagged commit, provided automatically by GitHub |

ZIP entries use a fixed timestamp and sorted ordering so repackaging the same
artifact produces the same checksum. Download the three attached assets into
one directory and run `sha256sum -c SHA256SUMS` to verify them.

`.github/release.yml` categorizes GitHub-generated change notes using PR labels:
`breaking-change`, `security`, `feature`/`enhancement`, `bug`/`fix`,
`dependencies`, `ci`/`infrastructure`/`release`, and `documentation`.
Unlabelled PRs go under Other changes; `skip-changelog` excludes a PR.
These labels affect notes, not the application version.

Publication starts with a draft. Assets are uploaded and checked against
GitHub's reported sizes and SHA-256 digests before the release becomes public
and is marked latest. This also works with immutable releases. If an upload
fails, use **Re-run failed jobs**: completed assets are reused, incomplete
uploads are cleaned up, and the draft is published after all assets verify.
A retry of an already published release with identical assets performs reads
only and does not change the latest-release pointer.

Re-running *all* jobs may produce new provider deployment IDs or different
compiled bytes. If these differ from an existing release, publication fails
without replacing its assets. Start a new manual workflow run on `main` to
record a new deployment instead. Tag/release ownership or checksum conflicts
also fail explicitly; do not delete tags merely to bypass a conflict.

Release publication failures do not roll back an already healthy production
deployment. Investigate the failed release job and retry it. Rollback remains
the explicit provider/schema procedure above. Android debug-signed review
APKs remain Actions artifacts; signed Android/iOS store packages are not
attached or published by this job.

## Verification boundaries

Local deployment/release tests use provider doubles and prove the pipeline's
decision logic. Actual GitHub Actions verification results are recorded in
`VERIFICATION.md`. Render/Vercel credentials, live release publication and live
Flutterwave still require configured production services.

Primary references used for this configuration:

- https://docs.github.com/en/actions/writing-workflows/workflow-syntax-for-github-actions
- https://docs.github.com/en/repositories/releasing-projects-on-github/automatically-generated-release-notes
- https://docs.github.com/en/rest/releases/releases
- https://docs.github.com/en/rest/releases/assets
- https://render.com/docs/blueprint-spec
- https://render.com/docs/environment-variables
- https://api-docs.render.com/reference/create-deploy
- https://api-docs.render.com/reference/retrieve-deploy
- https://vercel.com/docs/build-output-api/configuration
- https://vercel.com/docs/project-configuration/git-configuration
- https://vercel.com/docs/cli
