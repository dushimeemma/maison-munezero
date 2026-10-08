# Hosted sandbox review

Use `develop` for this review deployment and a separate database. Keep
`CD_ENABLED=false`; the existing production workflow and root `render.yaml`
remain the live-shop release path on `main`.

## Render API

Import `render.sandbox.yaml` as a Blueprint from the reviewed `develop` branch.
It creates the `maison-munezero-api-sandbox` Docker web service and a separate
`maison-munezero-sandbox-db` PostgreSQL 17 database in Frankfurt. Free database
availability must be checked first: Render permits one active free PostgreSQL
database per workspace and it expires after 30 days. Do not reuse another
application's database or change its plan. If no free slot is available, select
an explicitly approved database plan or supply a separate existing test database.

Set these values directly in Render's setup form; never paste secrets into chat:

| Setting | Value |
| --- | --- |
| `ADMIN_EMAIL` | Your review administrator email |
| `ADMIN_PASSWORD` | A unique password of at least 12 characters |
| `FLUTTERWAVE_SECRET_KEY` | Your v3 test key starting with `FLWSECK_TEST-` |

The Blueprint sets `NODE_ENV=development`, `FLUTTERWAVE_MODE=test`, a generated
webhook secret and the confirmed Vercel sandbox origin for CORS. It connects
through Render's internal database URL; `DB_SSL=false` applies to that private
connection only. For an external database, use its documented TLS configuration
and certificate verification.

Free services have no dashboard shell or paid pre-deploy jobs. The sandbox's
Docker command therefore runs the existing locked migrations and idempotent
admin/sample-catalogue seed before starting the API. Seeding never overwrites
an existing administrator password. Auto-deploy is off; deploy a tested commit
from `develop` explicitly after CI passes.

After deployment, copy the service's actual assigned HTTPS URL from Render.
Check `/api/v1/health`: it must report `status: ok`, service
`maison-munezero-api` and the intended commit revision. Do not assume an
`onrender.com` hostname from the service name.

Free services sleep when idle, so payment polling stops while they sleep;
`Check payment` performs verification after the service wakes. Free services
also block common SMTP ports, so email recovery/verification is not part of
this free review deployment. Image upload requires separate Cloudinary setup.
Use approved paid infrastructure and complete business credentials for live
operations. Render limitations: https://render.com/docs/free

## Vercel Flutter web

The connected team is `dushimeemma's projects` and the review project is
`maison-munezero-sandbox` (`prj_KgsvAcRublyDfc9DRtiGJjb9UHU5`). Its confirmed
domain is `maison-munezero-sandbox.vercel.app`.

| Project setting | Value |
| --- | --- |
| Framework | Other |
| Root directory | Repository root |
| Node.js | 24.x |
| Install command | `node --version` |
| Build command | `bash scripts/vercel-build.sh` |
| Output directory | Leave unset; `.vercel/output` uses Build Output API v3 |
| `API_BASE_URL` | Actual Render HTTPS service URL followed by `/api/v1` |

Set `API_BASE_URL` in the Vercel environment used for the review deployment.
This is a public URL; database and payment keys belong only on Render. The
build script validates the URL, uses pinned Flutter 3.35.4, compiles the web
app and packages the existing SPA routes and commit/API release metadata.
Changing `API_BASE_URL` requires rebuilding the frontend.

Deploy the exact reviewed commit from `develop` after backend health passes.
The root configuration keeps automatic Git deployment disabled: request the
review deployment explicitly, or use the existing tested artifact with the
Vercel CLI. The review project's canonical Vercel domain is a sandbox website,
even when Vercel calls its canonical-domain target `production`.

Verify the deployed `maison-release.json` revision and API URL, then open the
site and check catalogue loading, administrator sign-in, customer registration
and an order. Use a new sandbox payment to check **Request payment → Continue
payment → Check payment**. Provider test success is not a real-money payment;
existing uncertain requests must still be independently reconciled.
