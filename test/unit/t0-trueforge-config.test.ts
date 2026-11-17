import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { getTrueForgeConfig } from '../../src/trueforge/config';

describe('Task T0: Pinned TrueForge Version Configuration', () => {
  const origEnv = process.env.TRUEFORGE_VERSION;

  beforeEach(() => {
    delete process.env.TRUEFORGE_VERSION;
  });

  afterEach(() => {
    if (origEnv !== undefined) {
      process.env.TRUEFORGE_VERSION = origEnv;
    } else {
      delete process.env.TRUEFORGE_VERSION;
    }
  });

  it('defaults trueforgeVersion to 0.184.3', () => {
    const config = getTrueForgeConfig();
    expect(config.trueforgeVersion).toBe('0.184.3');
  });

  it('respects TRUEFORGE_VERSION environment variable override', () => {
    process.env.TRUEFORGE_VERSION = '0.184.3-custom';
    const config = getTrueForgeConfig();
    expect(config.trueforgeVersion).toBe('0.184.3-custom');
  });

  it('verifies package.json contributes forge.trueforgeVersion configuration with default 0.184.3', () => {
    const pkgPath = path.resolve(__dirname, '../../package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    const tfVersionConfig = pkg.contributes?.configuration?.properties?.['forge.trueforgeVersion'];
    expect(tfVersionConfig).toBeDefined();
    expect(tfVersionConfig.default).toBe('0.184.3');
  });

  it('verifies start-trueforge scripts explicitly reference version 0.184.3', () => {
    const shPath = path.resolve(__dirname, '../../scripts/start-trueforge.sh');
    const jsPath = path.resolve(__dirname, '../../scripts/start-trueforge.js');

    expect(fs.existsSync(shPath)).toBe(true);
    expect(fs.existsSync(jsPath)).toBe(true);

    const shContent = fs.readFileSync(shPath, 'utf-8');
    const jsContent = fs.readFileSync(jsPath, 'utf-8');

    expect(shContent).toContain('@truefoundry/trueforge@0.184.3');
    expect(jsContent).toContain('0.184.3');
  });
});
