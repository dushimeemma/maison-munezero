import { fileURLToPath } from 'node:url';
import { apiBase, revision, website } from './ci-config.mjs';

export async function checkWeb({ siteUrl, commit, apiBaseUrl, fetchImpl = globalThis.fetch }) {
  const site = website(siteUrl), sha = revision(commit), api = apiBase(apiBaseUrl);
  const request = async path => {
    const response = await fetchImpl(`${site}${path}`, { cache: 'no-store', signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error(`Website check ${path} returned HTTP ${response.status}`);
    return response;
  };
  const meta = await (await request(`/maison-release.json?commit=${sha}`)).json();
  if (meta.commit !== sha || meta.apiBaseUrl !== api) throw new Error('Website has an unexpected release or API URL');
  const html = await (await request('/')).text();
  if (!html.includes('Maison Munezero') || !html.includes('flutter_bootstrap.js')) throw new Error('Website HTML is not the Flutter storefront');
  const js = await request('/main.dart.js');
  if (!/javascript/.test(js.headers.get('content-type') || '')) throw new Error('Flutter JavaScript was not served correctly');
  await js.body?.cancel();
  return { site, commit: sha };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await checkWeb({ siteUrl: process.env.WEB_SITE_URL, commit: process.env.GITHUB_SHA, apiBaseUrl: process.env.API_BASE_URL });
  console.log('Website HTML, JavaScript and release metadata checks passed.');
}
