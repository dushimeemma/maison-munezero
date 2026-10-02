import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
export function run(command, args, cwd = root) {
  const windows = process.platform === 'win32';
  const result = spawnSync(command, args, {
    cwd, stdio: 'inherit', shell: windows,
    env: { ...process.env, FLUTTER_SUPPRESS_ANALYTICS: 'true' },
  });
  if (result.error) throw new Error(`${command} could not start: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${command} exited with status ${result.status}`);
}

export const flutter = process.env.FLUTTER_BIN || 'flutter';
export const flutterDir = fileURLToPath(new URL('../apps/flutter/', import.meta.url));
const commands = {
  'flutter-install': () => run(flutter, ['pub', 'get'], flutterDir),
  'flutter-analyze': () => run(flutter, ['analyze', '--no-pub'], flutterDir),
  'flutter-test': () => run(flutter, ['test', '--no-pub'], flutterDir),
  verify: () => {
    run('npm', ['run', 'ci:test']);
    run('npm', ['test', '--prefix', 'apps/api']);
    run(flutter, ['analyze', '--no-pub'], flutterDir);
    run(flutter, ['test', '--no-pub'], flutterDir);
  },
};
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const command = commands[process.argv[2]];
  if (!command) throw new Error('Choose flutter-install, flutter-analyze, flutter-test or verify');
  command();
}
