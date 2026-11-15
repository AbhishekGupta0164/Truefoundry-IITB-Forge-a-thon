import { describe, expect, it, afterAll, beforeAll } from 'vitest';
import { MCPServer } from '../../src/mcp/server';
import { WorkspaceManager } from '../../src/mcp/workspace';
import * as path from 'path';

describe('MCPServer Integration', () => {
  const fixtureDir = path.resolve(__dirname, '../fixtures/mini-repo');
  const workspace = new WorkspaceManager(fixtureDir);
  const server = new MCPServer({
    port: 9876,
    host: '127.0.0.1',
    workspace
  });

  beforeAll(async () => {
    await server.start();
  });

  afterAll(async () => {
    await server.stop();
  });

  it('responds to health check on 127.0.0.1', async () => {
    const res = await fetch('http://127.0.0.1:9876/health');
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.status).toBe('healthy');
  });

  it('lists available MCP tools', async () => {
    const res = await fetch('http://127.0.0.1:9876/tools');
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(Array.isArray(data.tools)).toBe(true);
    expect(data.tools.some((t: any) => t.name === 'read_file')).toBe(true);
    expect(data.tools.some((t: any) => t.name === 'propose_edit')).toBe(true);
  });

  it('executes read_file tool via /call-tool endpoint', async () => {
    const res = await fetch('http://127.0.0.1:9876/call-tool', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'read_file',
        arguments: {
          file_path: 'app.py',
          reason: 'Integration test read'
        }
      })
    });
    expect(res.status).toBe(200);
    const data = await res.json() as any;
    expect(data.success).toBe(true);
    expect(data.content).toContain('def calculate_total');
  });
});
