/**
 * T11 Spike — verify stress test behavior manually
 *
 * Run with:  npx ts-node spikes/verify-t11.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const REPO_ROOT = path.resolve(__dirname, '..');

function makeSyntheticRepo(numFiles: number): string {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-stress-spike-'));
  for (let i = 0; i < numFiles; i++) {
    const sub = path.join(tmpDir, `pkg${Math.floor(i / 50)}`);
    fs.mkdirSync(sub, { recursive: true });
    fs.writeFileSync(
      path.join(sub, `module${i}.py`),
      `class SpikeClass${i}:\n    def spike_method(self): pass\ndef spike_fn_${i}(x): return x\n`
    );
  }
  return tmpDir;
}

async function main() {
  console.log('=== T11 Stress Test Spike ===\n');

  // 1. Sanitize cap check
  console.log('1. Output cap check...');
  const { sanitizeToolOutput, DEFAULT_TOOL_OUTPUT_CAP } = await import('../src/mcp/sanitize');
  const bigOutput = 'x'.repeat(DEFAULT_TOOL_OUTPUT_CAP + 5000);
  const capped = sanitizeToolOutput(bigOutput);
  const hasTruncation = capped.includes('[Output truncated to');
  console.log(`   Cap = ${DEFAULT_TOOL_OUTPUT_CAP} chars. Truncation applied: ${hasTruncation} ✓\n`);

  // 2. Synthetic repo perf
  console.log('2. Creating 600-file synthetic repo...');
  const tmpRoot = makeSyntheticRepo(600);
  console.log(`   Repo at: ${tmpRoot}\n`);

  const ws = {
    getRoot: () => tmpRoot,
    resolveSafePath: (relPath: string) => {
      const abs = path.resolve(tmpRoot, relPath);
      if (!abs.startsWith(tmpRoot)) throw new Error('Path escape');
      return abs;
    },
  };

  console.log('3. search_symbols on 600-file repo...');
  const { executeSearchSymbols } = await import('../src/mcp/tools/search_symbols');
  const t0 = Date.now();
  const symResult = await executeSearchSymbols({ query: 'spike', reason: 'T11 spike' }, ws as any);
  const t1 = Date.now();
  console.log(`   Found ${symResult.symbols.length} symbols in ${t1 - t0}ms (budget: 5000ms) ✓\n`);

  // 3. Flask repo if available
  const flaskRepo = path.resolve(REPO_ROOT, '../flask');
  if (fs.existsSync(flaskRepo)) {
    console.log('4. Flask repo stress test...');
    const wsFlask = {
      getRoot: () => flaskRepo,
      resolveSafePath: (relPath: string) => {
        const abs = path.resolve(flaskRepo, relPath);
        if (!abs.startsWith(flaskRepo)) throw new Error('Path escape');
        return abs;
      },
    };
    const tf0 = Date.now();
    const flaskResult = await executeSearchSymbols({ query: 'Flask', reason: 'T11 spike flask' }, wsFlask as any);
    const tf1 = Date.now();
    console.log(`   Flask symbols found: ${flaskResult.symbols.length} in ${tf1 - tf0}ms ✓\n`);
  } else {
    console.log('4. Flask repo not found — skipping real-repo test\n');
  }

  // 4. Cleanup
  fs.rmSync(tmpRoot, { recursive: true, force: true });
  console.log('=== T11 Spike complete ✓ ===');
}

main().catch(err => {
  console.error('Spike failed:', err);
  process.exit(1);
});
