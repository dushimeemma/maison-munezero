import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { apiBase, requireValues, revision, website } from './ci-config.mjs';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

export function releaseConfig(env, versions) {
  if (env.GITHUB_REF !== 'refs/heads/main' || env.CD_ENABLED !== 'true' ||
      !['push', 'workflow_dispatch'].includes(env.GITHUB_EVENT_NAME) ||
      env.DEPLOY_BACKEND_RESULT !== 'success' || env.DEPLOY_FRONTEND_RESULT !== 'success') {
    throw new Error('Releases require successful backend and frontend production deployments on main');
  }
  requireValues(env, ['GITHUB_REPOSITORY', 'GITHUB_RUN_ID', 'GITHUB_RUN_NUMBER', 'RENDER_DEPLOY_ID',
    'API_BASE_URL', 'WEB_SITE_URL', 'VERCEL_DEPLOYMENT_URL']);
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(env.GITHUB_REPOSITORY) ||
      !/^[1-9]\d*$/.test(env.GITHUB_RUN_ID) || !/^[1-9]\d*$/.test(env.GITHUB_RUN_NUMBER)) {
    throw new Error('Invalid GitHub repository or workflow run identity');
  }
  if (!/^dep-[A-Za-z0-9]+$/.test(env.RENDER_DEPLOY_ID)) throw new Error('Invalid Render deployment ID');
  const stableVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
  if (!stableVersion.test(versions.root) || versions.api !== versions.root || versions.flutter !== versions.root) {
    throw new Error('Root, API and Flutter must have the same stable semantic version');
  }
  return {
    tag: `v${versions.root}+deploy.${env.GITHUB_RUN_NUMBER}`,
    version: versions.root,
    commit: revision(env.GITHUB_SHA),
    repository: env.GITHUB_REPOSITORY,
    runId: env.GITHUB_RUN_ID,
    runNumber: env.GITHUB_RUN_NUMBER,
    runUrl: `https://github.com/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`,
    api: { url: apiBase(env.API_BASE_URL), renderDeploymentId: env.RENDER_DEPLOY_ID },
    web: { url: website(env.WEB_SITE_URL), deploymentUrl: website(env.VERCEL_DEPLOYMENT_URL) },
  };
}

export async function prepareRelease({ env, root, webOutput = join(root, '.vercel/output'),
  output = join(root, '.vercel/release') }) {
  const [rootPackage, apiPackage, pubspec, metadata, config] = await Promise.all([
    readFile(join(root, 'package.json'), 'utf8'), readFile(join(root, 'apps/api/package.json'), 'utf8'),
    readFile(join(root, 'apps/flutter/pubspec.yaml'), 'utf8'),
    readFile(join(webOutput, 'static/maison-release.json'), 'utf8'),
    readFile(join(webOutput, 'config.json'), 'utf8'),
  ]);
  const flutterVersion = /^version:\s*(\d+\.\d+\.\d+)\+[1-9]\d*\s*$/m.exec(pubspec)?.[1];
  const manifest = releaseConfig(env, { root: JSON.parse(rootPackage).version,
    api: JSON.parse(apiPackage).version, flutter: flutterVersion });
  const webMetadata = JSON.parse(metadata);
  if (webMetadata.commit !== manifest.commit || webMetadata.apiBaseUrl !== manifest.api.url ||
      JSON.parse(config).version !== 3) throw new Error('Web artifact does not match the deployed revision or API URL');
  await Promise.all(['static/index.html', 'static/main.dart.js'].map(path => readFile(join(webOutput, path))));

  // Sorting entries and fixing ZIP timestamps makes assets identical across workflow retries.
  const entries = [];
  async function collect(directory = '') {
    const children = await readdir(join(webOutput, directory), { withFileTypes: true });
    children.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    for (const entry of children) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await collect(path);
      else if (entry.isFile()) {
        await utimes(join(webOutput, path), new Date('1980-01-01T00:00:00Z'), new Date('1980-01-01T00:00:00Z'));
        entries.push(path);
      } else throw new Error('Web artifact must contain only regular files and directories');
    }
  }
  await collect();
  await mkdir(output, { recursive: true });
  const archivePath = resolve(output, 'maison-munezero-web.zip');
  // Start a fresh archive; an old ZIP could otherwise retain deleted files.
  await rm(archivePath, { force: true });
  execFileSync('zip', ['-X', '-q', archivePath, ...entries], {
    cwd: webOutput, env: { ...process.env, TZ: 'UTC' }, timeout: 60000,
  });
  const assets = [
    { name: 'maison-munezero-web.zip', contentType: 'application/zip', bytes: await readFile(archivePath) },
    { name: 'deployment.json', contentType: 'application/json', bytes: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`) },
  ];
  for (const asset of assets) asset.digest = `sha256:${sha256(asset.bytes)}`;
  const checksums = assets.map(asset => `${asset.digest.slice(7)}  ${asset.name}`).join('\n');
  assets.push({ name: 'SHA256SUMS', contentType: 'text/plain', bytes: Buffer.from(`${checksums}\n`) });
  assets.at(-1).digest = `sha256:${sha256(assets.at(-1).bytes)}`;
  await Promise.all(assets.slice(1).map(asset => writeFile(join(output, asset.name), asset.bytes)));
  return { manifest, assets };
}
