import { appendFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { prepareRelease, sha256 } from './prepare-release.mjs';
import { requireValues, revision } from './ci-config.mjs';

export async function publishRelease({ manifest, assets, token, fetchImpl = globalThis.fetch }) {
  requireValues({ GITHUB_TOKEN: token }, ['GITHUB_TOKEN']);
  const { repository, tag, commit, runId } = manifest;
  const sandbox = manifest.channel === 'sandbox';
  const manifestName = sandbox ? 'review.json' : 'deployment.json';
  revision(commit);
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) ||
      !(sandbox ? /^v\d+\.\d+\.\d+-sandbox\.[1-9]\d*$/ : /^v\d+\.\d+\.\d+\+deploy\.[1-9]\d*$/).test(tag) || !/^[1-9]\d*$/.test(runId)) {
    throw new Error('Invalid release identity');
  }
  const requiredAssets = sandbox ? ['SHA256SUMS', 'maison-android-review.apk', 'maison-munezero-web.zip', 'review.json'] : ['SHA256SUMS', 'deployment.json', 'maison-munezero-web.zip'];
  if (JSON.stringify(assets.map(asset => asset.name).sort()) !== JSON.stringify(requiredAssets) ||
      !assets.find(asset => asset.name === manifestName).bytes.equals(Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`))) {
    throw new Error('Release requires the web bundle, matching deployment manifest and checksums');
  }
  for (const asset of assets) {
    if (asset.digest !== `sha256:${sha256(asset.bytes)}`) throw new Error('Release asset checksum mismatch');
  }
  const prefix = `/repos/${repository}`;
  const marker = `<!-- maison-release:${commit}:${runId} -->`;
  const request = async (path, { method = 'GET', body, upload = false, missing = false, contentType } = {}) => {
    const response = await fetchImpl(`https://${upload ? 'uploads' : 'api'}.github.com${prefix}${path}`, {
      method, redirect: 'error', signal: AbortSignal.timeout(upload ? 120000 : 20000),
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2026-03-10', 'Content-Type': contentType || 'application/json' },
      body: body === undefined ? undefined : upload ? body : JSON.stringify(body),
    });
    if (missing && response.status === 404) return null;
    if (!response.ok) throw new Error(`GitHub release API ${method} returned HTTP ${response.status}`);
    return response.status === 204 ? null : response.json();
  };
  const list = async (path, match) => {
    const collected = [];
    for (let page = 1; page <= 100; page++) {
      const batch = await request(`${path}?per_page=100&page=${page}`);
      if (!Array.isArray(batch)) throw new Error('Unexpected GitHub release list');
      if (match) {
        const found = batch.find(match);
        if (found) return found;
      } else collected.push(...batch);
      if (batch.length < 100) return match ? null : collected;
    }
    throw new Error('GitHub release pagination limit exceeded');
  };

  // Inspect annotated tags as well as lightweight tags; never move an existing tag.
  const ref = await request(`/git/ref/tags/${encodeURIComponent(tag)}`, { missing: true });
  if (ref) {
    let object = ref.object;
    for (let depth = 0; object?.type === 'tag' && depth < 8; depth++) {
      revision(object.sha);
      object = (await request(`/git/tags/${object.sha}`)).object;
    }
    if (object?.type !== 'commit' || object.sha !== commit) throw new Error('Release tag points to a different commit');
  }
  // List includes drafts, allowing a failed asset upload to resume on a later attempt.
  let release = await list('/releases', item => item.tag_name === tag);
  if (release && (!ref || release.target_commitish !== commit || !release.body?.includes(marker) || release.prerelease !== sandbox)) {
    throw new Error('Existing release does not belong to this production deployment');
  }
  if (!ref) await request('/git/refs', { method: 'POST', body: { ref: `refs/tags/${tag}`, sha: commit } });
  if (!release) {
    const notes = await request('/releases/generate-notes', { method: 'POST', body: {
      tag_name: tag, target_commitish: commit, configuration_file_path: '.github/release.yml',
    } });
    const body = sandbox ? [marker, `Sandbox review build of **${manifest.version}** at commit \`${commit}\`.`,
      `CI workflow and checks: ${manifest.runUrl}`, `Test website: ${manifest.web.url}`, `Test API: ${manifest.api.url}`,
      'Testing only. The APK uses the review signing key and the sandbox API. It is not a Play Store package. '
        + 'The web ZIP contains this CI build. Hosting deploys independently; this release does not certify the currently hosted revision.',
      'Assets include the Android review APK, web bundle, review metadata and SHA-256 checksums.', notes.body || '',
    ].join('\n\n') : [marker, `Production deployment of **${manifest.version}** at commit \`${commit}\`.`,
      `Website: ${manifest.web.url}`, `API: ${manifest.api.url}`,
      `Render deployment: \`${manifest.api.renderDeploymentId}\``,
      `Vercel deployment: ${manifest.web.deploymentUrl}`, `Verified workflow: ${manifest.runUrl}`,
      'Assets contain the deployed Vercel web output, deployment metadata and SHA-256 checksums. '
        + 'Android review APKs remain in workflow artifacts; store-signed Android/iOS packages are not included.',
      notes.body || '',
    ].join('\n\n');
    release = await request('/releases', { method: 'POST', body: {
      tag_name: tag, target_commitish: commit, name: `Maison Munezero ${tag}`, body,
      draft: true, prerelease: sandbox, ...(sandbox ? { make_latest: 'false' } : {}),
    } });
  }
  if (!Number.isSafeInteger(release.id) || release.id <= 0) throw new Error('Invalid GitHub release ID');
  const existingAssets = await list(`/releases/${release.id}/assets`);
  for (const asset of assets) {
    const existing = existingAssets.find(item => item.name === asset.name);
    if (existing?.state === 'uploaded') {
      if (existing.digest !== asset.digest || existing.size !== asset.bytes.length) {
        throw new Error(`Existing release asset differs: ${asset.name}`);
      }
      continue;
    }
    if (!release.draft) throw new Error(`Published release asset is missing: ${asset.name}`);
    if (existing) {
      if (!Number.isSafeInteger(existing.id) || existing.id <= 0) throw new Error('Invalid GitHub asset ID');
      await request(`/releases/assets/${existing.id}`, { method: 'DELETE' });
    }
    const uploaded = await request(`/releases/${release.id}/assets?name=${encodeURIComponent(asset.name)}`, {
      method: 'POST', upload: true, contentType: asset.contentType, body: asset.bytes,
    });
    if (uploaded.state !== 'uploaded' || uploaded.digest !== asset.digest || uploaded.size !== asset.bytes.length) {
      throw new Error(`Release asset upload verification failed: ${asset.name}`);
    }
  }
  // Publishing last also supports immutable releases: assets are complete before publication.
  // A rerun of an already published release does not change the latest-release pointer.
  if (release.draft) release = await request(`/releases/${release.id}`, {
    method: 'PATCH', body: { draft: false, make_latest: sandbox ? 'false' : 'true' },
  });
  if (release.draft || release.tag_name !== tag) throw new Error('GitHub release publication did not complete');
  return { tag, url: release.html_url, commit };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const prepared = await prepareRelease({ env: process.env, root });
  const result = await publishRelease({ ...prepared, token: process.env.GITHUB_TOKEN });
  if (process.env.GITHUB_OUTPUT) await appendFile(process.env.GITHUB_OUTPUT, `tag=${result.tag}\nurl=${result.url}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY,
    `Production release: [${result.tag}](${result.url}) — ${result.commit}\n`);
  console.log(`Published production release: ${result.tag}`);
}
