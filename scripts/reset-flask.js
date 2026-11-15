#!/usr/bin/env node
/**
 * Cross-platform Flask reset runner.
 */
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const repoRoot = path.resolve(__dirname, '..');
const candidates = [
  process.env.FLASK_DIR,
  path.resolve(repoRoot, '..', 'Flask'),
  path.resolve(repoRoot, '..', 'flask')
].filter(Boolean);

let targetFlask = null;
for (const cand of candidates) {
  if (fs.existsSync(path.join(cand, '.git'))) {
    targetFlask = cand;
    break;
  }
}

if (!targetFlask) {
  console.error('ERROR: Flask repository not found.');
  process.exit(1);
}

if (path.resolve(targetFlask) === repoRoot) {
  console.error('FATAL: Target directory is the TrueForge extension repository itself!');
  process.exit(1);
}

console.log('=== Resetting Flask test repository ===');
console.log('Target:', targetFlask);

execFileSync('git', ['checkout', '--', '.'], { cwd: targetFlask, stdio: 'inherit' });
execFileSync('git', ['clean', '-fd'], { cwd: targetFlask, stdio: 'inherit' });

const status = execFileSync('git', ['status', '--porcelain'], { cwd: targetFlask, encoding: 'utf-8' }).trim();
if (!status) {
  console.log('✓ Flask working tree is completely clean!');
} else {
  console.log('Remaining git status:', status);
}
console.log('=== Flask reset complete ===');
