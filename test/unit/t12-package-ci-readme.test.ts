/**
 * T12 — Package VSIX, CI, README
 *
 * Verifies submission readiness:
 * - .vscodeignore excludes non-distribution files
 * - package.json defines correct packaging scripts and metadata
 * - demo/README.md provides reproduction instructions
 * - .github/workflows/ci.yml defines continuous integration gates
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const REPO_ROOT = path.resolve(__dirname, '../..');

describe('T12 — Package VSIX, CI, README', () => {
  it('.vscodeignore exists and excludes test, src, and config directories', () => {
    const ignorePath = path.join(REPO_ROOT, '.vscodeignore');
    expect(fs.existsSync(ignorePath)).toBe(true);

    const content = fs.readFileSync(ignorePath, 'utf-8');
    expect(content).toContain('.vscode/**');
    expect(content).toContain('test/**');
    expect(content).toContain('src/**');
    expect(content).toContain('node_modules/**');
  });

  it('package.json contains packaging scripts and valid extension metadata', () => {
    const pkgPath = path.join(REPO_ROOT, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));

    expect(pkg.name).toBe('forge-agent');
    expect(pkg.main).toBe('./dist/extension.js');
    expect(pkg.scripts['vscode:prepublish']).toBe('npm run build');
    expect(pkg.scripts['package']).toBeDefined();
    expect(pkg.scripts['vsce-package']).toBeDefined();
  });

  it('demo/README.md exists and includes instructions for Tasks A, B, and C', () => {
    const demoPath = path.join(REPO_ROOT, 'demo/README.md');
    expect(fs.existsSync(demoPath)).toBe(true);

    const content = fs.readFileSync(demoPath, 'utf-8');
    expect(content).toContain('Task A');
    expect(content).toContain('Task B');
    expect(content).toContain('Task C');
    expect(content).toContain('start:all');
  });

  it('.github/workflows/ci.yml triggers on feat branches and verifies build and package', () => {
    const ciPath = path.join(REPO_ROOT, '.github/workflows/ci.yml');
    expect(fs.existsSync(ciPath)).toBe(true);

    const content = fs.readFileSync(ciPath, 'utf-8');
    expect(content).toContain('feat/*');
    expect(content).toContain('npm run test:unit');
    expect(content).toContain('vsce package');
  });
});
