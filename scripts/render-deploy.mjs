import { appendFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { apiBase, requireValues, revision } from './ci-config.mjs';

export async function deployRender({ apiKey, serviceId, commit, apiBaseUrl,
  fetchImpl = globalThis.fetch, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  pollIntervalMs = 15000, maxPolls = 120, log = console.log }) {
  requireValues({ RENDER_API_KEY: apiKey, RENDER_SERVICE_ID: serviceId }, ['RENDER_API_KEY', 'RENDER_SERVICE_ID']);
  if (!/^srv-[A-Za-z0-9]+$/.test(serviceId)) throw new Error('Invalid Render service ID');
  const sha = revision(commit);
  const base = apiBase(apiBaseUrl);
  const endpoint = `https://api.render.com/v1/services/${serviceId}/deploys`;
  const request = async (url, options = {}) => {
    const response = await fetchImpl(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(20000),
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json',
        'Content-Type': 'application/json' } });
    if (!response.ok) throw new Error(`Render API returned HTTP ${response.status}`);
    return response.json();
  };
  // Do not retry this POST automatically: a timeout may already have created a deployment.
  const created = await request(endpoint, { method: 'POST',
    body: JSON.stringify({ commitId: sha, clearCache: 'do_not_clear' }) });
  if (!/^dep-[A-Za-z0-9]+$/.test(created.id || '')) throw new Error('Render did not return a deployment ID');
  const failed = new Set(['build_failed', 'update_failed', 'pre_deploy_failed', 'canceled', 'deactivated']);
  for (let attempt = 0; attempt < maxPolls; attempt++) {
    const deploy = await request(`${endpoint}/${created.id}`);
    log(`Render deployment ${created.id}: ${deploy.status}`);
    if (failed.has(deploy.status)) throw new Error(`Render deployment ended with ${deploy.status}`);
    if (deploy.status === 'live') {
      if (deploy.commit?.id !== sha) throw new Error('Render deployed a different commit; frontend deployment stopped');
      const response = await fetchImpl(`${base}/health`, { redirect: 'error', signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error(`API health check returned HTTP ${response.status}`);
      const health = await response.json();
      if (health.status !== 'ok' || health.service !== 'maison-munezero-api' || health.revision !== sha) {
        throw new Error('Public API health/revision check failed; frontend deployment stopped');
      }
      return { id: created.id, commit: sha, status: 'live' };
    }
    if (attempt + 1 < maxPolls) await sleep(pollIntervalMs);
  }
  throw new Error('Render deployment exceeded the polling deadline; frontend deployment stopped');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const result = await deployRender({ apiKey: process.env.RENDER_API_KEY, serviceId: process.env.RENDER_SERVICE_ID,
    commit: process.env.GITHUB_SHA, apiBaseUrl: process.env.API_BASE_URL });
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `deployment_id=${result.id}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY,
    `API deployment: **${result.status}** — ${result.commit} (${result.id})\n`);
}
