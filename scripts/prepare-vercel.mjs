import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { apiBase, revision } from './ci-config.mjs';

export async function prepareVercel({ source, output, commit, apiBaseUrl }) {
  // Fail before changing output if the source build or metadata is invalid.
  await readFile(`${source}/index.html`, 'utf8');
  await readFile(`${source}/main.dart.js`);
  const metadata = { commit: revision(commit), apiBaseUrl: apiBase(apiBaseUrl, true) };
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  await cp(source, `${output}/static`, { recursive: true });
  await writeFile(`${output}/static/maison-release.json`, `${JSON.stringify(metadata)}\n`);
  await writeFile(`${output}/config.json`, `${JSON.stringify({
    version: 3,
    routes: [
      { src: '/(.*)', headers: {
        'Cache-Control': 'public, max-age=0, must-revalidate',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'SAMEORIGIN',
        'Referrer-Policy': 'strict-origin-when-cross-origin',
      }, continue: true },
      { handle: 'filesystem' },
      { src: '/(?!assets/|canvaskit/|icons/|.*\\.[^/]+$).*', dest: '/index.html' },
    ],
  }, null, 2)}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const root = fileURLToPath(new URL('../', import.meta.url));
  await prepareVercel({ source: `${root}apps/flutter/build/web`, output: `${root}.vercel/output`,
    commit: process.env.GITHUB_SHA, apiBaseUrl: process.env.API_BASE_URL || '/api/v1' });
  console.log('Prepared Flutter web as Vercel Build Output API v3.');
}
