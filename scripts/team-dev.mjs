import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import net from 'node:net';

// Development launcher only. Reuses Next and the existing authenticated app;
// it does not load a model gateway, another runtime, or another data schema.
/** @param {string[]} args @param {string} root @param {Record<string, string | undefined>} inherited */
export function teamConfiguration(args, root, inherited = process.env) {
  const options = new Map();
  for (const argument of args) {
    if (argument === '--check') continue;
    const match = /^--(name|port)=(.+)$/.exec(argument);
    if (!match || options.has(match[1])) throw Error('Use --name=alice --port=3251 [--check]');
    options.set(match[1], match[2]);
  }
  const name = options.get('name') || 'local';
  const port = options.get('port') || '3250';
  if (!/^[a-z][a-z0-9-]{0,31}$/.test(name)) throw Error('name must be 1–32 lowercase letters/digits/hyphens, starting with a letter');
  if (!/^\d{4,5}$/.test(port) || Number(port) < 1024 || Number(port) > 65535) throw Error('port must be 1024–65535');
  return {
    name, port, url: `http://127.0.0.1:${port}`,
    env: {
      ...inherited,
      NODE_ENV: 'development',
      PORT: port,
      AUTH_MODE: 'authenticated',
      PRODUCT_AGENT_DATA_DIR: path.resolve(root, '.runtime', 'team-dev', name),
      WUJIAN_BUILD_DIR: `.next-team-${name}`,
      AI_ALLOW_PAID_CALLS: 'false', WUJIAN_ALLOW_PAID_CALLS: 'false',
      WUJIAN_ALLOW_SEARCH: 'false', WUJIAN_ALLOW_PUBLIC_FETCH: 'false',
      WUJIAN_EXPERIMENTAL_FACT_QA: 'false', WUJIAN_EXPERIMENTAL_KERNEL_V3: 'false',
      WUJIAN_ENABLE_DEVICE_LAB: 'false',
      LANGSMITH_TRACING: 'false', LANGCHAIN_TRACING_V2: 'false',
      NEXT_TELEMETRY_DISABLED: '1',
    },
  };
}

async function main() {
  if (Number(process.versions.node.split('.')[0]) !== 24) throw Error('Use Node.js 24 for this repository');
  const root = fileURLToPath(new URL('../', import.meta.url));
  const config = teamConfiguration(process.argv.slice(2), root);
  // Deliberately print an allowlist, never the inherited environment or keys.
  console.log(JSON.stringify({url: config.url, dataDirectory: config.env.PRODUCT_AGENT_DATA_DIR,
    buildDirectory: config.env.WUJIAN_BUILD_DIR, authentication: 'authenticated',
    paidCalls: false, publicFetch: false}, null, 2));
  if (process.argv.includes('--check')) return;
  await new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(Number(config.port), '127.0.0.1', () => probe.close(resolve));
  });
  const child = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev',
    '--hostname', '127.0.0.1', '--port', config.port], {
    cwd: root, env: config.env, windowsHide: true, stdio: 'inherit',
  });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
  child.on('error', () => { console.error('Cannot start Next.js; check npm ci and the local port'); process.exitCode = 1; });
  child.on('exit', code => { process.exitCode = code ?? 1; });
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
