#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"

missing=0
for tool in node npm ngrok; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    case "$tool" in
      node|npm) printf 'Missing %s. Install Node.js 22.13+ (includes npm): https://nodejs.org/en/download\n' "$tool" >&2 ;;
      ngrok) printf 'Missing ngrok. Install it: https://ngrok.com/download\n' >&2 ;;
    esac
    missing=1
  fi
done
[ "$missing" -eq 0 ] || exit 1
if ! node -e 'var v=process.versions.node.split(".").map(Number); process.exit(v[0]>22 || (v[0]===22 && v[1]>=13) ? 0 : 1)'; then
  printf 'Node.js 22.13+ is required. Install it: https://nodejs.org/en/download\n' >&2
  exit 1
fi

# Node parses .env safely; it is never executed as shell code.
exec node --input-type=module <<'NODE'
import { existsSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';

const children = new Set();
let stopping = false;
function redact(text) {
  for (const [key, value] of Object.entries(process.env)) {
    if (/KEY|TOKEN|SECRET/.test(key) && value) text = text.replaceAll(value, '[redacted]');
  }
  return text;
}
async function stop(code, error) {
  if (stopping) return;
  stopping = true;
  if (error) console.error(`\nStartup failed: ${redact(error.message || String(error))}`);
  for (const child of children) {
    try { process.kill(-child.pid, 'SIGTERM'); } catch { /* Already stopped. */ }
  }
  await Promise.race([
    Promise.all([...children].map(child => child.exitCode !== null || child.signalCode !== null ? undefined : new Promise(resolve => child.once('exit', resolve)))),
    delay(3000),
  ]);
  for (const child of children) {
    try { process.kill(-child.pid, 'SIGKILL'); } catch { /* Already stopped. */ }
  }
  process.exit(code);
}
process.on('SIGINT', () => void stop(0));
process.on('SIGTERM', () => void stop(0));
function start(command, args, stdio = 'inherit') {
  const child = spawn(command, args, { stdio, detached: true });
  children.add(child);
  child.once('error', error => void stop(1, new Error(`Cannot start ${command}: ${error.message}`)));
  return child;
}
async function availablePort(port) {
  await new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', () => reject(new Error(`Port ${port} is already in use. Stop the app using it, then rerun ./run.sh.`)));
    server.listen(port, '127.0.0.1', () => server.close(resolve));
  });
}
try {
  if (!existsSync('.env')) {
    copyFileSync('.env.example', '.env');
    console.log('Created .env from .env.example.');
  }
  process.loadEnvFile('.env');
  const port = Number(process.env.PORT?.trim() || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be a whole number from 1 to 65535. Leave it empty to use 3000.');
  const localUrl = `http://127.0.0.1:${port}`;
  const palId = process.env.TAVUS_PAL_ID?.trim();
  const required = ['TAVUS_API_KEY', 'RECALL_API_KEY', ...(palId ? [] : ['TAVUS_FACE_ID'])];
  const missing = required.filter(key => !process.env[key]?.trim() || /^(YOUR[_ -]|REPLACE[_ -]|<)/i.test(process.env[key].trim()));
  if (missing.length) throw new Error(`Set ${missing.join(', ')} in .env. Tavus key: https://maker.tavus.io/ · Recall key: https://us-east-1.recall.ai/dashboard/. See README.md for Tavus face setup.`);
  for (const key of required) process.env[key] = process.env[key].trim();
  if (palId && (!/^[A-Za-z0-9_-]{2,128}$/.test(palId) || /^(YOUR[_ -]|REPLACE[_ -])/i.test(palId))) throw new Error('TAVUS_PAL_ID must be an existing Tavus PAL ID, or leave it empty to create temporary PALs.');
  if (!palId && !/^[A-Za-z0-9_-]{2,128}$/.test(process.env.TAVUS_FACE_ID)) throw new Error('TAVUS_FACE_ID must be a Tavus face ID. See the Tavus instructions in README.md.');
  const region = process.env.RECALL_REGION || 'us-east-1';
  if (!['us-east-1', 'us-west-2', 'eu-central-1', 'ap-northeast-1'].includes(region)) throw new Error('RECALL_REGION must be us-east-1, us-west-2, eu-central-1, or ap-northeast-1. Use the region of your Recall workspace.');
  process.env.RECALL_REGION = region;
  const duration = Number(process.env.TAVUS_MAX_CALL_DURATION || 600);
  if (!Number.isInteger(duration) || duration < 60 || duration > 3600) throw new Error('TAVUS_MAX_CALL_DURATION must be a whole number from 60 to 3600 seconds, within your Tavus plan limit.');
  await availablePort(port);

  const hash = createHash('sha256').update(readFileSync('package-lock.json')).digest('hex');
  const stamp = 'node_modules/.run-lock';
  if (!existsSync('node_modules/next/dist/bin/next') || !existsSync(stamp) || readFileSync(stamp, 'utf8') !== hash) {
    console.log('Installing dependencies with npm ci…');
    const installer = start('npm', ['ci', '--no-audit', '--no-fund']);
    const code = await new Promise(resolve => installer.once('exit', resolve));
    if (code !== 0) throw new Error('npm ci failed. Check the npm output above, your network connection, and write permissions, then rerun ./run.sh.');
    children.delete(installer);
    writeFileSync(stamp, hash);
  }

  console.log('Starting ngrok…');
  let publicUrl;
  let ngrokLog = '';
  let pending = '';
  const tunnel = start('ngrok', ['http', localUrl, '--log=stdout', '--log-format=json'], ['ignore', 'pipe', 'pipe']);
  tunnel.stdout.on('data', chunk => {
    const text = chunk.toString();
    ngrokLog = (ngrokLog + text).slice(-12000);
    pending += text;
    const lines = pending.split('\n'); pending = lines.pop();
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (entry.msg === 'started tunnel' && typeof entry.url === 'string' && entry.url.startsWith('https://')) publicUrl = new URL(entry.url).origin;
      } catch { /* Ignore non-JSON startup notices. */ }
    }
  });
  tunnel.stderr.on('data', chunk => { ngrokLog = (ngrokLog + chunk).slice(-12000); });
  const ngrokHelp = () => `ngrok could not keep the tunnel running.\n${ngrokLog}\nFor authentication errors, run: ngrok config add-authtoken <YOUR_AUTHTOKEN>\nGet the token at https://dashboard.ngrok.com/get-started/your-authtoken. Also check your connection and ngrok account/endpoint limits.`;
  tunnel.once('exit', () => { if (!stopping) void stop(1, new Error(ngrokHelp())); });
  for (let attempt = 0; !publicUrl && attempt < 120; attempt++) await delay(250);
  if (!publicUrl) throw new Error(`Timed out waiting for ngrok.\n${ngrokHelp()}`);
  process.env.NGROK_URL = publicUrl;
  console.log(`Tunnel: ${publicUrl}`);
  console.log('Starting the local app…');
  const app = start(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '--hostname', '127.0.0.1', '--port', String(port)]);
  app.once('exit', () => { if (!stopping) void stop(1, new Error('The app stopped. Check the Next.js output above; fix the reported error and rerun ./run.sh.')); });
  let ready = false;
  for (let attempt = 0; !ready && attempt < 120; attempt++) {
    try {
      const response = await fetch(localUrl, { signal: AbortSignal.timeout(1000) });
      ready = response.ok && (await response.text()).includes('<title>Live Agent Sample App</title>');
    } catch { /* The dev server may still be compiling. */ }
    if (!ready) await delay(500);
  }
  if (!ready) throw new Error(`The app did not become ready on port ${port}. Check the Next.js output above.`);
  const response = await fetch(`${publicUrl}/`, { headers: { 'ngrok-skip-browser-warning': 'true' }, signal: AbortSignal.timeout(15000) });
  if (!response.ok || !(await response.text()).includes('<title>Live Agent Sample App</title>')) throw new Error('The app runs locally, but the public ngrok URL does not reach it. Check ngrok traffic policies and account limits.');
  console.log(`\nReady: http://localhost:${port}\nPublic tunnel: ${publicUrl}\nKeep this terminal open. Ctrl+C stops the app and tunnel.\n`);
} catch (error) {
  await stop(1, error);
}
NODE
