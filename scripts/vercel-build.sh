#!/usr/bin/env bash
set -euo pipefail

# Vercel builds the Flutter web app when a reviewed Git deployment is requested.
# Production Actions still deploy their already-verified Build Output artifact.
cd "$(dirname "$0")/.."

# Validate the public API target before downloading or compiling anything.
node --input-type=module -e 'import { apiBase } from "./scripts/ci-config.mjs"; apiBase(process.env.API_BASE_URL);'
export GITHUB_SHA="${GITHUB_SHA:-${VERCEL_GIT_COMMIT_SHA:-$(git rev-parse HEAD)}}"
node --input-type=module -e 'import { revision } from "./scripts/ci-config.mjs"; revision(process.env.GITHUB_SHA);'

flutter_version=3.35.4
flutter_sdk_dir="$PWD/.cache/flutter"
if [[ ! -x "$flutter_sdk_dir/bin/flutter" ]]; then
  git clone --depth 1 --branch "$flutter_version" https://github.com/flutter/flutter.git "$flutter_sdk_dir"
fi
if [[ "$(git -C "$flutter_sdk_dir" describe --tags --exact-match)" != "$flutter_version" ]]; then
  echo "Unexpected cached Flutter version; clear the Vercel build cache and retry." >&2
  exit 1
fi
export FLUTTER_BIN="$flutter_sdk_dir/bin/flutter"
export FLUTTER_SUPPRESS_ANALYTICS=true
"$FLUTTER_BIN" config --no-analytics
npm run flutter:install
npm run web:build
npm run web:package
