import * as http from 'http';
import { Readable } from 'stream';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MCPServerManager } from '../../src/mcp/server';
import { MCPAuthenticator } from '../../src/mcp/auth';
import { InMemorySecretStorage } from '../helpers/vscode-mock';
import { WorkspaceManager } from '../../src/mcp/workspace';
import { ContextBudgetTracker } from '../../src/context/budget';
import { PatchStore } from '../../src/review/store';

describe('MCP Server Integration and Authentication (Items 1-5)', () => {
  let secretStorage: InMemorySecretStorage;
  let authenticator: MCPAuthenticator;
  let serverManager: MCPServerManager;
  let serverPort: number;
  let validToken: string;

  beforeAll(async () => {
    secretStorage = new InMemorySecretStorage();
    authenticator = new MCPAuthenticator(secretStorage as any);
    validToken = await authenticator.getOrCreateToken();

    serverPort = 8765;
    serverManager = new MCPServerManager(
      authenticator,
      new WorkspaceManager(),
      new ContextBudgetTracker(),
      new PatchStore()
    );

    try {
      await serverManager.start({ port: serverPort });
    } catch {
      serverPort = 8785;
      await serverManager.start({ port: serverPort });
    }
  });

  afterAll(async () => {
    await serverManager.stop();
  });

  function makeRequest(
    method: string,
    pathname: string,
    token?: string,
    body?: any
  ): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
    return new Promise((resolve) => {
      const headers: http.OutgoingHttpHeaders = {
        accept: 'application/json, text/event-stream'
      };
      if (token) {
        headers['authorization'] = `Bearer ${token}`;
      }
      if (body) {
        headers['content-type'] = 'application/json';
      }

      const req = http.request(
        {
          host: '127.0.0.1',
          port: serverPort,
          method,
          path: pathname,
          headers
        },
        (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            resolve({
              status: res.statusCode || 0,
              headers: res.headers,
              body: data
            });
          });
        }
      );

      req.on('error', (err: any) => {
        // If sandboxed loopback socket connects are blocked by OS sandbox, fallback to in-memory dispatch
        if (err.code === 'EACCES') {
          const rawServer = serverManager.getHttpServer();
          if (!rawServer) {
            resolve({ status: 500, headers: {}, body: 'No server' });
            return;
          }

          const mockReq: any = new Readable();
          mockReq.url = pathname;
          mockReq.method = method;
          mockReq.headers = {
            host: `127.0.0.1:${serverPort}`,
            ...headers
          };
          mockReq._read = () => {};
          const rawHeaders: string[] = [];
          for (const [k, v] of Object.entries(mockReq.headers)) {
            rawHeaders.push(k, String(v));
          }
          mockReq.rawHeaders = rawHeaders;
          mockReq.httpVersion = '1.1';
          mockReq.socket = {
            remoteAddress: '127.0.0.1',
            encrypted: false
          };

          const serializedBody = body ? JSON.stringify(body) : '';
          if (serializedBody) {
            const buf = Buffer.from(serializedBody, 'utf-8');
            mockReq.headers['content-length'] = buf.length.toString();
            mockReq.push(buf);
          }
          mockReq.push(null);

          const mockRes: any = new http.ServerResponse(mockReq);
          let capturedBody = '';
          mockRes.write = (chunk: any) => {
            if (chunk) capturedBody += Buffer.isBuffer(chunk) || chunk instanceof Uint8Array ? Buffer.from(chunk).toString('utf-8') : String(chunk);
            return true;
          };
          mockRes.end = (chunk: any) => {
            if (chunk) capturedBody += Buffer.isBuffer(chunk) || chunk instanceof Uint8Array ? Buffer.from(chunk).toString('utf-8') : String(chunk);
            resolve({
              status: mockRes.statusCode || 200,
              headers: mockRes.getHeaders(),
              body: capturedBody
            });
          };

          rawServer.emit('request', mockReq, mockRes);
          return;
        }
        resolve({ status: 500, headers: {}, body: err.message });
      });

      if (body) {
        req.write(JSON.stringify(body));
      }
      req.end();
    });
  }

  it('starts MCP server strictly bound to 127.0.0.1 on configured port (Item 1)', () => {
    expect(serverManager.isRunning()).toBe(true);
    expect(serverManager.getHost()).toBe('127.0.0.1');
    expect(serverManager.getHost()).not.toBe('0.0.0.0');
    expect(serverManager.getPort()).toBe(serverPort);
  });

  it('serves the correct /mcp endpoint and returns 404 for unknown endpoints (Item 2)', async () => {
    const res = await makeRequest('POST', '/unknown-endpoint', validToken, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1.0' } }
    });
    expect(res.status).toBe(404);
  });

  it('returns HTTP 401 for requests missing a bearer token (Item 3)', async () => {
    const res = await makeRequest('POST', '/mcp', undefined, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1.0' } }
    });
    expect(res.status).toBe(401);
    expect(res.body).toContain('Unauthorized');
  });

  it('returns HTTP 401 for requests with an invalid bearer token (Item 4)', async () => {
    const res = await makeRequest('POST', '/mcp', 'invalid-token-1234567890abcdef', {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1.0' } }
    });
    expect(res.status).toBe(401);
    expect(res.body).toContain('Unauthorized');
  });

  it('accepts requests with a valid bearer token and initializes MCP (Item 5)', async () => {
    const res = await makeRequest('POST', '/mcp', validToken, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test', version: '1.0' }
      }
    });
    expect(res.status).toBe(200);
    expect(res.body).toContain('forge-workspace');
    expect(res.body).toContain('2024-11-05');
  });
});
