import { apiBase } from './ci-config.mjs';
import { run, flutter, flutterDir } from './project.mjs';
const base = apiBase(process.env.API_BASE_URL || '/api/v1', true);
if (process.env.CD_ENABLED === 'true') apiBase(base);
run(flutter, ['build', 'web', '--release', '--no-pub', '--no-tree-shake-icons',
  '--no-web-resources-cdn', `--dart-define=API_BASE_URL=${base}`], flutterDir);
