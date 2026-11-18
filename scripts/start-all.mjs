#!/usr/bin/env node
/**
 * scripts/start-all.mjs
 * T5: Cross-platform launcher for TrueForge (and Ollama if needed).
 * No bash dependencies — works on Windows, macOS, Linux.
 *
 * Usage:  npm run start:all
 *         node scripts/start-all.mjs [--port 8790] [--version 0.184.3]
 */

import { spawn } from 'child_process';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { join, dirname } from 'path';

// ── Config from package.json defaults ────────────────────────────────────────
const __dir = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(__dir, '..', 'package.json'), 'utf8'));
const props = pkg.contributes.configuration.properties;

const args = process.argv.slice(2);
function argVal(flag) {
  const i = args.indexOf(flag);
  return i !== -1 ? args[i + 1] : null;
}

const PORT = argVal('--port') ?? String(props['forge.mcpPort']?.default ?? 8765);
const TF_PORT = argVal('--trueforge-port') ?? '8790';
const VERSION = argVal('--version') ?? props['forge.trueforgeVersion']?.default ?? '0.184.3';
const MODEL = argVal('--model') ?? props['forge.model']?.default ?? '';
const TF_URL = `http://localhost:${TF_PORT}`;
const WIN = process.platform === 'win32';

// ── Helpers ───────────────────────────────────────────────────────────────────

function log(msg) {
  process.stdout.write(`[start-all] ${msg}\n`);
}

async function isUp(url) {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(1500) });
    return r.status < 500;
  } catch {
    return false;
  }
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// ── Node version check ────────────────────────────────────────────────────────

const [major, minor] = process.version.replace('v', '').split('.').map(Number);
if (major < 22 || (major === 22 && minor < 14)) {
  log(`ERROR: Node ≥ 22.14 required (found ${process.version}). Download from https://nodejs.org`);
  process.exit(1);
}
log(`Node ${process.version} ✓`);

// ── Ollama (only for ollama/ models) ─────────────────────────────────────────

if (MODEL.startsWith('ollama/')) {
  const ollamaUp = await isUp('http://127.0.0.1:11434/api/tags');
  if (!ollamaUp) {
    log('Ollama not running — spawning `ollama serve`...');
    spawn(WIN ? 'ollama.cmd' : 'ollama', ['serve'], {
      detached: true,
      stdio: 'ignore',
      shell: WIN,
    }).unref();
    await sleep(3000);
  }

  // Check model availability
  try {
    const r = await fetch('http://127.0.0.1:11434/api/tags', { signal: AbortSignal.timeout(3000) });
    if (r.ok) {
      const data = await r.json();
      const models = (data.models ?? []).map(m => m.name);
      const ollamaName = MODEL.replace('ollama/', '').replace(/-/g, '.');
      const found = models.some(m => m.includes(ollamaName.split(':')[0]));
      if (!found) {
        log(`WARNING: Model "${MODEL}" not found locally. Run: ollama pull ${ollamaName}`);
      } else {
        log(`Ollama model "${MODEL}" ✓`);
      }
    }
  } catch {
    log('Could not verify Ollama model list (continuing anyway)');
  }
}

// ── TrueForge ────────────────────────────────────────────────────────────────

if (await isUp(TF_URL)) {
  log(`TrueForge already running at ${TF_URL} ✓`);
  process.exit(0);
}

log(`Starting TrueForge ${VERSION} on port ${TF_PORT}...`);

const tfArgs = ['--yes', `@truefoundry/trueforge@${VERSION}`, '--port', TF_PORT];
const tfProc = spawn(WIN ? 'npx.cmd' : 'npx', tfArgs, {
  env: {
    ...process.env,
    NETWORK_POLICY_ENABLED: 'false',
    OUTBOUND_URL_ALLOWED_HOSTS: '["localhost","127.0.0.1"]',
  },
  shell: WIN,
  stdio: 'inherit',
});

let ready = false;
for (let i = 0; i < 60; i++) {
  await sleep(1000);
  if (await isUp(TF_URL)) {
    ready = true;
    break;
  }
}

if (ready) {
  log(`TrueForge ready at ${TF_URL} ✓`);
  process.exit(0);
} else {
  log('ERROR: TrueForge did not start within 60 s. Check the output above for errors.');
  tfProc.kill();
  process.exit(1);
}
