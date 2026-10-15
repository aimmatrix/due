import { lstat, realpath, unlink } from 'node:fs/promises';
import { resolve, relative, dirname, isAbsolute } from 'node:path';
import { spawnSync } from 'node:child_process';
import { assert, baseUrl, required, scenario } from './lib';

void scenario('reset-local', async () => {
  assert(process.argv.includes('--yes'), 'explicit --yes required; stop server and workers first');
  assert(process.env.DEMO_MODE === 'true', 'DEMO_MODE enabled');
  const root = await realpath(process.cwd());
  const dataDir = resolve(root, 'data');
  const path = resolve(root, required('DATABASE_PATH'));
  const rel = relative(dataDir, path);
  assert(rel !== '' && !rel.startsWith('..') && !isAbsolute(rel) && path.endsWith('.db'), 'DATABASE_PATH is a .db strictly inside ./data/');
  assert(await realpath(dataDir) === dataDir && await realpath(dirname(path)) === dirname(path), 'data directory and parents contain no symlinks');
  try {
    const info = await lstat(path);
    assert(info.isFile() && !info.isSymbolicLink() && info.nlink === 1, 'database is a regular file, not a symlink or hardlink');
  } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
  for (const suffix of ['-wal', '-shm', '-journal']) {
    try { await lstat(`${path}${suffix}`); throw new Error('SQLite sidecar present; stop every connection cleanly before reset'); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
  }
  const url = baseUrl();
  assert(['localhost', '127.0.0.1', '[::1]'].includes(url.hostname), 'reset targets a loopback app');
  let reachable = false;
  try { await fetch(new URL('/api/health', url), { signal: AbortSignal.timeout(2000), redirect: 'error' }); reachable = true; }
  catch (e) {
    // A timeout does not prove that the process has stopped.
    const cause = (e as { cause?: { code?: string } }).cause?.code;
    assert(cause === 'ECONNREFUSED', 'server is confirmed stopped (connection refused)');
  }
  assert(!reachable, 'HTTP server stopped; also stop the worker manually');
  await unlink(path).catch((e: NodeJS.ErrnoException) => { if (e.code !== 'ENOENT') throw e; });
  console.log('  Deleted only DATABASE_PATH; remote Stripe objects remain.');
  // There is no seed HTTP endpoint. Invoke the exact CLI behind npm run db:seed.
  const seed = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/seed.ts'], { cwd: root, env: process.env, encoding: 'utf8' });
  assert(seed.status === 0, 'canonical scripts/seed.ts migration + seed succeeded (output suppressed)');
});
