import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareRelease, releaseConfig, sha256 } from '../prepare-release.mjs';
import { publishRelease } from '../publish-release.mjs';

const sha = 'a'.repeat(40), otherSha = 'b'.repeat(40);
const env = { GITHUB_REF: 'refs/heads/main', GITHUB_EVENT_NAME: 'push', CD_ENABLED: 'true',
  DEPLOY_BACKEND_RESULT: 'success', DEPLOY_FRONTEND_RESULT: 'success',
  GITHUB_REPOSITORY: 'dushimeemma/maison-munezero', GITHUB_SHA: sha,
  GITHUB_RUN_ID: '123456', GITHUB_RUN_NUMBER: '12', RENDER_DEPLOY_ID: 'dep-tested',
  API_BASE_URL: 'https://maison-api.onrender.com/api/v1', WEB_SITE_URL: 'https://maison-munezero.vercel.app',
  VERCEL_DEPLOYMENT_URL: 'https://maison-deployment.vercel.app' };
const versions = { root: '1.0.0', api: '1.0.0', flutter: '1.0.0' };
const manifest = releaseConfig(env, versions);
const marker = `<!-- maison-release:${sha}:${env.GITHUB_RUN_ID} -->`;
function fixtureAssets() {
  const assets = [
    { name: 'maison-munezero-web.zip', bytes: Buffer.from('web fixture'), contentType: 'application/zip' },
    { name: 'deployment.json', bytes: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`), contentType: 'application/json' },
  ];
  const checksums = assets.map(asset => `${sha256(asset.bytes)}  ${asset.name}`).join('\n');
  assets.push({ name: 'SHA256SUMS', bytes: Buffer.from(`${checksums}\n`), contentType: 'text/plain' });
  return assets.map(asset => ({ ...asset, digest: `sha256:${sha256(asset.bytes)}` }));
}
function github(state = {}) {
  state.requests = [];
  state.assets ||= [];
  const fetchImpl = async (url, options) => {
    const target = new URL(url), path = decodeURIComponent(target.pathname.replace(`/repos/${env.GITHUB_REPOSITORY}`, ''));
    const method = options.method;
    state.requests.push({ path, method, body: options.body, host: target.hostname });
    assert.equal(options.headers.Authorization, 'Bearer test-only-token');
    assert.equal(options.redirect, 'error');
    assert.ok(['api.github.com', 'uploads.github.com'].includes(target.hostname));
    const json = (data, status = 200) => new Response(JSON.stringify(data), { status });
    if (state.authorizationFailure) return json({ message: 'test-only-token sensitive provider body' }, 403);
    if (path === `/git/ref/tags/${manifest.tag}`) return state.ref ? json(state.ref) : json({}, 404);
    if (path === `/git/tags/${otherSha}`) return json({ object: { type: 'commit', sha } });
    if (path === '/git/refs' && method === 'POST') {
      const body = JSON.parse(options.body);
      assert.equal(body.sha, sha);
      assert.equal(body.ref, `refs/tags/${manifest.tag}`);
      assert.equal(state.ref, undefined);
      state.ref = { object: { type: 'commit', sha } };
      return json(state.ref, 201);
    }
    if (path === '/releases' && method === 'GET') {
      if (state.secondPage && target.searchParams.get('page') === '1') {
        return json(Array.from({ length: 100 }, (_, index) => ({ tag_name: `other-${index}` })));
      }
      return json(state.release ? [state.release] : []);
    }
    if (path === '/releases/generate-notes') {
      const body = JSON.parse(options.body);
      assert.equal(body.configuration_file_path, '.github/release.yml');
      assert.equal(body.target_commitish, sha);
      return json({ body: '## Features\n\n* New storefront' });
    }
    if (path === '/releases' && method === 'POST') {
      const body = JSON.parse(options.body);
      assert.equal(body.draft, true, 'release must stay unpublished during uploads');
      assert.equal(body.target_commitish, sha);
      assert.ok(body.body.includes(marker));
      state.release = { ...body, id: 42, html_url: `https://github.com/${env.GITHUB_REPOSITORY}/releases/tag/${manifest.tag}` };
      return json(state.release, 201);
    }
    if (path === '/releases/42/assets' && method === 'GET') return json(state.assets);
    if (path.startsWith('/releases/assets/') && method === 'DELETE') {
      assert.equal(state.release.draft, true);
      state.assets = state.assets.filter(asset => asset.id !== Number(path.split('/').at(-1)));
      return new Response(null, { status: 204 });
    }
    if (path === '/releases/42/assets' && method === 'POST') {
      assert.equal(target.hostname, 'uploads.github.com');
      assert.equal(state.release.draft, true);
      const name = target.searchParams.get('name');
      assert.ok(!state.assets.some(asset => asset.name === name), 'completed assets are never overwritten');
      const asset = { name, id: state.assets.length + 100, size: options.body.length,
        digest: `sha256:${sha256(options.body)}`, state: 'uploaded' };
      if (state.failUpload === name) {
        state.assets.push({ ...asset, state: 'starter', size: 0, digest: null });
        return json({ message: 'sensitive provider body' }, 502);
      }
      state.assets.push(asset);
      return json({ ...asset, digest: state.corruptUpload ? 'sha256:wrong' : asset.digest }, 201);
    }
    if (path === '/releases/42' && method === 'PATCH') {
      assert.equal(state.assets.length, 3);
      assert.ok(state.assets.every(asset => asset.state === 'uploaded'));
      assert.deepEqual(JSON.parse(options.body), { draft: false, make_latest: 'true' });
      state.release = { ...state.release, draft: false };
      return json(state.release);
    }
    assert.fail(`Unexpected API request: ${method} ${path}`);
  };
  return { state, fetchImpl };
}
const publish = fetchImpl => publishRelease({ manifest, assets: fixtureAssets(), token: 'test-only-token', fetchImpl });

test('release gate rejects PRs, develop, disabled CD and unsuccessful deployment jobs', () => {
  for (const change of [{ GITHUB_EVENT_NAME: 'pull_request' }, { GITHUB_REF: 'refs/heads/develop' },
    { CD_ENABLED: 'false' }, { DEPLOY_BACKEND_RESULT: 'failure' }, { DEPLOY_FRONTEND_RESULT: 'skipped' },
    { DEPLOY_FRONTEND_RESULT: 'cancelled' }]) {
    assert.throws(() => releaseConfig({ ...env, ...change }, versions), /successful.*production deployments/);
  }
  assert.equal(releaseConfig({ ...env, GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_RUN_ATTEMPT: '2' }, versions).tag,
    'v1.0.0+deploy.12');
});

test('release identity requires aligned application versions and complete deployment metadata', () => {
  for (const change of [{ api: '1.1.0' }, { flutter: undefined }, { root: '1.0.0-beta.1' }, { root: '01.0.0' }]) {
    assert.throws(() => releaseConfig(env, { ...versions, ...change }), /same stable semantic version/);
  }
  for (const change of [{ GITHUB_SHA: 'short' }, { GITHUB_RUN_NUMBER: '0' }, { GITHUB_REPOSITORY: 'owner/repo/extra' },
    { RENDER_DEPLOY_ID: '' }, { VERCEL_DEPLOYMENT_URL: 'http://unsafe.test' }]) {
    assert.throws(() => releaseConfig({ ...env, ...change }, versions));
  }
});

test('checked-in monorepo application versions satisfy the production release gate', async () => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const [rootPackage, apiPackage, pubspec] = await Promise.all([
    readFile(join(root, 'package.json'), 'utf8'), readFile(join(root, 'apps/api/package.json'), 'utf8'),
    readFile(join(root, 'apps/flutter/pubspec.yaml'), 'utf8'),
  ]);
  releaseConfig(env, { root: JSON.parse(rootPackage).version, api: JSON.parse(apiPackage).version,
    flutter: /^version:\s*(\d+\.\d+\.\d+)\+[1-9]\d*\s*$/m.exec(pubspec)?.[1] });
});

test('web release ZIP and checksums are reproducible and stale artifacts fail before packaging', async () => {
  const root = await mkdtemp(join(tmpdir(), 'maison-release-'));
  try {
    for (const dir of ['apps/api', 'apps/flutter', '.vercel/output/static']) await mkdir(join(root, dir), { recursive: true });
    await Promise.all([
      writeFile(join(root, 'package.json'), JSON.stringify({ version: '1.0.0' })),
      writeFile(join(root, 'apps/api/package.json'), JSON.stringify({ version: '1.0.0' })),
      writeFile(join(root, 'apps/flutter/pubspec.yaml'), 'name: test\nversion: 1.0.0+1\n'),
      writeFile(join(root, '.vercel/output/config.json'), '{"version":3}'),
      writeFile(join(root, '.vercel/output/static/index.html'), '<title>Maison Munezero</title>'),
      writeFile(join(root, '.vercel/output/static/main.dart.js'), '/* verified web fixture */'),
      writeFile(join(root, '.vercel/output/static/maison-release.json'), JSON.stringify({ commit: sha, apiBaseUrl: env.API_BASE_URL })),
    ]);
    const first = await prepareRelease({ env, root });
    await utimes(join(root, '.vercel/output/static/main.dart.js'), new Date(), new Date());
    const second = await prepareRelease({ env, root });
    assert.deepEqual(second.assets, first.assets);
    assert.deepEqual(first.manifest, manifest);
    const archive = join(root, '.vercel/release/maison-munezero-web.zip');
    const archived = JSON.parse(execFileSync('unzip', ['-p', archive, 'static/maison-release.json'], { encoding: 'utf8' }));
    assert.equal(archived.commit, sha);
    const checksums = first.assets.find(asset => asset.name === 'SHA256SUMS').bytes.toString();
    for (const asset of first.assets.slice(0, 2)) assert.ok(checksums.includes(`${sha256(asset.bytes)}  ${asset.name}`));
    await writeFile(join(root, '.vercel/output/static/maison-release.json'), JSON.stringify({ commit: otherSha, apiBaseUrl: env.API_BASE_URL }));
    await assert.rejects(prepareRelease({ env, root }), /does not match the deployed revision/);
    assert.deepEqual(await readFile(archive), first.assets[0].bytes, 'invalid metadata cannot replace an existing archive');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('successful production deployment tags the exact commit and publishes only after all assets verify', async () => {
  const { fetchImpl, state } = github();
  const result = await publish(fetchImpl);
  assert.equal(result.tag, manifest.tag);
  assert.equal(result.commit, sha);
  assert.equal(state.release.draft, false);
  assert.equal(state.requests.at(-1).method, 'PATCH');
  assert.ok(state.release.body.includes('## Features'));
  assert.ok(state.release.body.includes(env.RENDER_DEPLOY_ID));
});

test('rerunning a published release verifies existing assets without mutation or changing latest', async () => {
  const { fetchImpl, state } = github();
  const original = await publish(fetchImpl);
  state.requests = [];
  assert.deepEqual(await publish(fetchImpl), original);
  assert.ok(state.requests.every(request => request.method === 'GET'));
});

test('failed upload stays draft and retries resume without overwriting completed assets', async () => {
  const { fetchImpl, state } = github({ failUpload: 'deployment.json' });
  await assert.rejects(publish(fetchImpl), /HTTP 502/);
  assert.equal(state.release.draft, true);
  state.failUpload = undefined;
  state.requests = [];
  await publish(fetchImpl);
  const uploads = state.requests.filter(request => request.host === 'uploads.github.com');
  assert.equal(uploads.length, 2, 'web archive is reused');
  assert.equal(state.requests.filter(request => request.method === 'DELETE').length, 1, 'incomplete upload is cleaned up');
  assert.equal(state.release.draft, false);
});

test('a tag pointing at a different commit blocks all release mutations', async () => {
  const { fetchImpl, state } = github({ ref: { object: { type: 'commit', sha: otherSha } } });
  await assert.rejects(publish(fetchImpl), /different commit/);
  assert.ok(state.requests.every(request => request.method === 'GET'));
});

test('an annotated tag resolving to the deployed commit is reused', async () => {
  const { fetchImpl, state } = github({ ref: { object: { type: 'tag', sha: otherSha } } });
  await publish(fetchImpl);
  assert.ok(!state.requests.some(request => request.path === '/git/refs'));
});

test('an existing release from a different workflow cannot be taken over', async () => {
  const { fetchImpl, state } = github({ ref: { object: { type: 'commit', sha } },
    release: { tag_name: manifest.tag, target_commitish: sha, body: 'Manual release', draft: true } });
  await assert.rejects(publish(fetchImpl), /does not belong/);
  assert.ok(state.requests.every(request => request.method === 'GET'));
});

test('draft lookup follows pagination before deciding whether to create a release', async () => {
  const { fetchImpl, state } = github();
  await publish(fetchImpl);
  state.secondPage = true;
  state.requests = [];
  await publish(fetchImpl);
  assert.equal(state.requests.filter(request => request.path === '/releases').length, 2);
  assert.ok(state.requests.every(request => request.method === 'GET'));
});

test('an uploaded asset with a different checksum fails without overwrite or publication', async () => {
  const { fetchImpl, state } = github({ failUpload: 'deployment.json' });
  await assert.rejects(publish(fetchImpl));
  state.failUpload = undefined;
  state.assets[0].digest = 'sha256:unexpected';
  state.requests = [];
  await assert.rejects(publish(fetchImpl), /Existing release asset differs/);
  assert.equal(state.release.draft, true);
  assert.ok(state.requests.every(request => request.method === 'GET'));
});

test('a corrupt upload response cannot publish the draft', async () => {
  const { fetchImpl, state } = github({ corruptUpload: true });
  await assert.rejects(publish(fetchImpl), /upload verification failed/);
  assert.equal(state.release.draft, true);
  assert.ok(!state.requests.some(request => request.method === 'PATCH'));
});

test('a published release missing an asset is left unchanged', async () => {
  const { fetchImpl, state } = github();
  await publish(fetchImpl);
  state.assets.pop();
  state.requests = [];
  await assert.rejects(publish(fetchImpl), /Published release asset is missing/);
  assert.ok(state.requests.every(request => request.method === 'GET'));
});

test('provider errors do not include tokens or provider response bodies', async () => {
  const { fetchImpl } = github({ authorizationFailure: true });
  await assert.rejects(publish(fetchImpl), error => error.message === 'GitHub release API GET returned HTTP 403');
});

test('missing or altered release assets fail before authenticated API access', async () => {
  const fetchImpl = async () => assert.fail('GitHub must not be called for invalid assets');
  await assert.rejects(publishRelease({ manifest, assets: [], token: 'test-only-token', fetchImpl }), /requires the web bundle/);
  const assets = fixtureAssets();
  assets[0].bytes = Buffer.from('altered');
  await assert.rejects(publishRelease({ manifest, assets, token: 'test-only-token', fetchImpl }), /checksum mismatch/);
});
