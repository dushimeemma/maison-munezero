import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apiBase, deploymentConfig } from '../ci-config.mjs';
import { deployRender } from '../render-deploy.mjs';
import { prepareVercel } from '../prepare-vercel.mjs';
import { checkWeb } from '../check-web.mjs';

const sha = 'a'.repeat(40), api = 'https://maison-api.onrender.com/api/v1';
const renderConfig = { apiKey: 'test-only-token', serviceId: 'srv-test', commit: sha, apiBaseUrl: api,
  sleep: async () => {}, log: () => {} };
const json = data => new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } });
function responses(values, requests = []) {
  return async (url, options) => {
    requests.push({ url, options });
    assert.ok(values.length, `Unexpected request: ${url}`);
    return values.shift();
  };
}

test('production configuration fails before deployment when credentials are missing', () => {
  assert.throws(() => deploymentConfig({}), /RENDER_API_KEY/);
  assert.throws(() => deploymentConfig({}), /VERCEL_TOKEN/);
});

test('API target rejects placeholders, embedded credentials and query injection', () => {
  for (const url of ['http://maison-api.onrender.com/api/v1', 'https://api.example.invalid/api/v1',
    'https://user:password@maison-api.onrender.com/api/v1', `${api}?token=secret`,
    'https://maison-api.onrender.com/other']) assert.throws(() => apiBase(url));
  assert.equal(apiBase(`${api}/`), api);
  assert.equal(apiBase('/api/v1', true), '/api/v1');
  assert.throws(() => apiBase('/api/v1'));
});

test('deploys the verified commit and waits for its public API revision', async () => {
  const requests = [];
  const result = await deployRender({ ...renderConfig, fetchImpl: responses([
    json({ id: 'dep-test' }), json({ status: 'build_in_progress' }),
    json({ status: 'live', commit: { id: sha } }),
    json({ status: 'ok', service: 'maison-munezero-api', revision: sha }),
  ], requests) });
  assert.equal(result.status, 'live');
  assert.deepEqual(JSON.parse(requests[0].options.body), { commitId: sha, clearCache: 'do_not_clear' });
  assert.equal(requests.at(-1).url, `${api}/health`);
  assert.equal(requests.at(-1).options.headers, undefined, 'deployment token never sent to public API');
});

test('a failed migration blocks the frontend release', async () => {
  await assert.rejects(deployRender({ ...renderConfig, fetchImpl: responses([
    json({ id: 'dep-test' }), json({ status: 'pre_deploy_failed' }),
  ]) }), /pre_deploy_failed/);
});

test('a different deployed commit blocks the frontend release', async () => {
  await assert.rejects(deployRender({ ...renderConfig, fetchImpl: responses([
    json({ id: 'dep-test' }), json({ status: 'live', commit: { id: 'b'.repeat(40) } }),
  ]) }), /different commit/);
});

test('a stale public API blocks the frontend release', async () => {
  await assert.rejects(deployRender({ ...renderConfig, fetchImpl: responses([
    json({ id: 'dep-test' }), json({ status: 'live', commit: { id: sha } }),
    json({ status: 'ok', service: 'maison-munezero-api', revision: 'b'.repeat(40) }),
  ]) }), /health\/revision/);
});

test('deployment polling has a finite deadline', async () => {
  await assert.rejects(deployRender({ ...renderConfig, maxPolls: 2, fetchImpl: responses([
    json({ id: 'dep-test' }), json({ status: 'build_in_progress' }), json({ status: 'build_in_progress' }),
  ]) }), /deadline/);
});

test('provider authentication failure surfaces without leaking response or token', async () => {
  await assert.rejects(deployRender({ ...renderConfig, fetchImpl: responses([
    new Response('sensitive provider body', { status: 401 }),
  ]) }), error => error.message === 'Render API returned HTTP 401');
});

test('web package identifies the checked release and retains real assets before SPA fallback', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'maison-ci-'));
  try {
    await mkdir(`${dir}/source`);
    await writeFile(`${dir}/source/index.html`, '<title>Maison Munezero</title>');
    await writeFile(`${dir}/source/main.dart.js`, '/* fixture */');
    await prepareVercel({ source: `${dir}/source`, output: `${dir}/output`, commit: sha, apiBaseUrl: api });
    assert.deepEqual(JSON.parse(await readFile(`${dir}/output/static/maison-release.json`, 'utf8')),
      { commit: sha, apiBaseUrl: api });
    const config = JSON.parse(await readFile(`${dir}/output/config.json`, 'utf8'));
    assert.equal(config.version, 3);
    const filesystem = config.routes.findIndex(route => route.handle === 'filesystem');
    const fallback = config.routes.findIndex(route => route.dest === '/index.html');
    assert.ok(filesystem >= 0 && fallback > filesystem);
    assert.equal(await readFile(`${dir}/output/static/main.dart.js`, 'utf8'), '/* fixture */');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('website verification rejects stale output and validates a current Flutter release', async () => {
  const opts = { siteUrl: 'https://maison-munezero.vercel.app', commit: sha, apiBaseUrl: api };
  await assert.rejects(checkWeb({ ...opts, fetchImpl: responses([
    json({ commit: 'b'.repeat(40), apiBaseUrl: api }),
  ]) }), /unexpected release/);
  const result = await checkWeb({ ...opts, fetchImpl: responses([
    json({ commit: sha, apiBaseUrl: api }),
    new Response('<title>Maison Munezero</title><script src="flutter_bootstrap.js"></script>'),
    new Response('/* compiled */', { headers: { 'content-type': 'application/javascript' } }),
  ]) });
  assert.equal(result.commit, sha);
});
