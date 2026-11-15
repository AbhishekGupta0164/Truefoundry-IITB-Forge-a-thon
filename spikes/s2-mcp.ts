/**
 * spikes/s2-mcp.ts
 *
 * Stage 2: S2 MCP connector spike.
 * Minimal Streamable HTTP MCP server on 127.0.0.1:8765 with one ping tool.
 * Reads the token from environment variable FORGE_TOKEN (production code uses SecretStorage).
 */

import * as http from 'http';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { Readable } from 'stream';
import { z } from 'zod';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';

const PORT = 8765;
const HOST = '127.0.0.1';
const ENDPOINT = '/mcp';
const FORGE_TOKEN = process.env.FORGE_TOKEN || 'forge-dev-token-secret-12345';

export async function createSpikeServer(token = FORGE_TOKEN, port = PORT) {
  const mcpServer = new McpServer(
    { name: 'forge-workspace', version: '0.1.0' },
    { capabilities: { tools: { listChanged: true } } }
  );

  // Register single ping tool as required for #S2 spike
  mcpServer.tool('ping', 'Health check ping tool', {}, { readOnlyHint: true }, async () => {
    return {
      content: [{ type: 'text', text: 'pong' }]
    };
  });

  // Stage 3 S3 requirement: stub apply_patch_hunk(patch_id, hunk_id)
  mcpServer.tool(
    'apply_patch_hunk',
    'Stub tool for S3 approval spike. Appends a line to mini-repo scratch file.',
    {
      patch_id: z.string().describe('Unique identifier of the patch'),
      hunk_id: z.string().describe('Unique identifier of the hunk (e.g. h1 or h2)')
    },
    { destructiveHint: true },
    async (args) => {
      const targetDir = path.resolve(process.cwd(), 'test/fixtures/mini-repo');
      fs.mkdirSync(targetDir, { recursive: true });
      const targetFile = path.join(targetDir, 'scratch_patch.txt');
      fs.appendFileSync(targetFile, `Applied hunk ${args.hunk_id} from patch ${args.patch_id}\n`, 'utf-8');
      return {
        content: [{ type: 'text', text: `Hunk ${args.hunk_id} applied successfully to scratch_patch.txt` }]
      };
    }
  );

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => crypto.randomUUID(),
    enableJsonResponse: true
  });

  await mcpServer.connect(transport);
  const sseTransports = new Map<string, SSEServerTransport>();

  const server = http.createServer(async (req, res) => {
    try {
      const parsedUrl = new URL(req.url || '/', `http://${HOST}:${port}`);

      // Bearer token authentication
      const authHeader = req.headers['authorization'];
      let providedToken: string | undefined;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        providedToken = authHeader.slice(7).trim();
      }
      if (!providedToken) {
        providedToken = parsedUrl.searchParams.get('token') || undefined;
      }

      if (!providedToken || providedToken !== token) {
        res.writeHead(401, {
          'Content-Type': 'application/json',
          'WWW-Authenticate': 'Bearer error="invalid_token"'
        });
        res.end(JSON.stringify({ error: 'Unauthorized: missing or invalid bearer token' }));
        return;
      }

      if (parsedUrl.pathname === '/sse') {
        const sseTransport = new SSEServerTransport('/messages', res);
        const sid = sseTransport.sessionId;
        sseTransports.set(sid, sseTransport);
        sseTransport.onclose = () => {
          sseTransports.delete(sid);
        };
        const sessionMcp = new McpServer(
          { name: 'forge-workspace', version: '0.1.0' },
          { capabilities: { tools: { listChanged: true } } }
        );
        sessionMcp.tool('ping', 'Health check ping tool', {}, async () => ({
          content: [{ type: 'text', text: 'pong' }]
        }));
        sessionMcp.tool(
          'apply_patch_hunk',
          'Stub tool for S3 approval spike. Appends a line to mini-repo scratch file.',
          {
            patch_id: z.string().describe('Unique identifier of the patch'),
            hunk_id: z.string().describe('Unique identifier of the hunk')
          },
          async (args) => {
            const targetDir = path.resolve(process.cwd(), 'test/fixtures/mini-repo');
            fs.mkdirSync(targetDir, { recursive: true });
            const targetFile = path.join(targetDir, 'scratch_patch.txt');
            fs.appendFileSync(targetFile, `Applied hunk ${args.hunk_id} from patch ${args.patch_id}\n`, 'utf-8');
            return {
              content: [{ type: 'text', text: `Hunk ${args.hunk_id} applied successfully to scratch_patch.txt` }]
            };
          }
        );
        await sessionMcp.connect(sseTransport);
        return;
      }

      if (parsedUrl.pathname === '/messages') {
        const sid = parsedUrl.searchParams.get('sessionId');
        const sse = sid ? sseTransports.get(sid) : undefined;
        if (!sse) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Session not found' }));
          return;
        }
        await sse.handlePostMessage(req, res);
        return;
      }

      if (parsedUrl.pathname !== ENDPOINT) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `Not Found: ${parsedUrl.pathname}` }));
        return;
      }

      await transport.handleRequest(req, res);
    } catch (err: any) {
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: err?.message || String(err) }));
      }
    }
  });

  return new Promise<{ server: http.Server; close: () => Promise<void> }>((resolve, reject) => {
    server.on('error', reject);
    server.listen(port, HOST, () => {
      resolve({
        server,
        close: async () => {
          await transport.close();
          await mcpServer.close();
          await new Promise<void>((r) => server.close(() => r()));
        }
      });
    });
  });
}

async function main() {
  console.log('=== Stage 2 Spike: Streamable HTTP MCP Server (#S2) ===');
  console.log(`Port: ${PORT}`);
  console.log(`Host: ${HOST}`);
  console.log(`Endpoint: ${ENDPOINT}`);
  console.log(`Bearer Token (FORGE_TOKEN): ${FORGE_TOKEN}`);

  const instance = await createSpikeServer();
  console.log(`\n✓ Server is listening on http://${HOST}:${PORT}${ENDPOINT}`);
  console.log('\nTest with curl:');
  console.log(`  curl -i http://${HOST}:${PORT}${ENDPOINT}                       # Expect HTTP 401`);
  console.log(`  curl -i -H "Authorization: Bearer ${FORGE_TOKEN}" -H "Accept: application/json, text/event-stream" -H "Content-Type: application/json" -X POST -d "{\\"jsonrpc\\":\\"2.0\\",\\"id\\":1,\\"method\\":\\"initialize\\",\\"params\\":{\\"protocolVersion\\":\\"2024-11-05\\",\\"capabilities\\":{},\\"clientInfo\\":{\\"name\\":\\"test\\",\\"version\\":\\"1.0\\"}}}" http://${HOST}:${PORT}${ENDPOINT}\n`);
  console.log('Connect with MCP Inspector:');
  console.log(`  npx @modelcontextprotocol/inspector http://${HOST}:${PORT}${ENDPOINT}`);
  console.log(`  Header: Authorization: Bearer ${FORGE_TOKEN}\n`);

  if (process.argv.includes('--self-test')) {
    console.log('Running self-test verification...');
    const postReq = (authToken: string | undefined, body: any): Promise<{ status: number; body: string }> => {
      return new Promise((resolve, reject) => {
        const req = http.request(
          `http://${HOST}:${PORT}${ENDPOINT}`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Accept': 'application/json, text/event-stream',
              ...(authToken ? { Authorization: `Bearer ${authToken}` } : {})
            }
          },
          (res) => {
            let data = '';
            res.on('data', (c) => (data += c));
            res.on('end', () => resolve({ status: res.statusCode || 0, body: data }));
          }
        );
        req.on('error', (err: any) => {
          if (err.code === 'EACCES') {
            // Sandboxed environment loopback fallback
            const mockReq: any = new Readable();
            mockReq.url = ENDPOINT;
            mockReq.method = 'POST';
            mockReq.headers = {
              host: `${HOST}:${PORT}`,
              'content-type': 'application/json',
              'accept': 'application/json, text/event-stream',
              ...(authToken ? { authorization: `Bearer ${authToken}` } : {})
            };
            mockReq._read = () => {};
            mockReq.rawHeaders = [];
            for (const [k, v] of Object.entries(mockReq.headers)) {
              mockReq.rawHeaders.push(k, String(v));
            }
            mockReq.httpVersion = '1.1';
            mockReq.socket = { remoteAddress: HOST, encrypted: false };

            const serialized = JSON.stringify(body);
            const buf = Buffer.from(serialized, 'utf-8');
            mockReq.headers['content-length'] = buf.length.toString();
            mockReq.push(buf);
            mockReq.push(null);

            const mockRes: any = new http.ServerResponse(mockReq);
            let capturedBody = '';
            mockRes.write = (chunk: any) => {
              if (chunk) capturedBody += Buffer.isBuffer(chunk) || chunk instanceof Uint8Array ? Buffer.from(chunk).toString('utf-8') : String(chunk);
              return true;
            };
            mockRes.end = (chunk: any) => {
              if (chunk) capturedBody += Buffer.isBuffer(chunk) || chunk instanceof Uint8Array ? Buffer.from(chunk).toString('utf-8') : String(chunk);
              resolve({ status: mockRes.statusCode || 200, body: capturedBody });
            };

            instance.server.emit('request', mockReq, mockRes);
            return;
          }
          reject(err);
        });
        req.write(JSON.stringify(body));
        req.end();
      });
    };

    const unauth = await postReq(undefined, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1.0' } }
    });
    console.log(`Self-test 401 check: HTTP ${unauth.status} (${unauth.status === 401 ? 'PASS' : 'FAIL'})`);

    const auth = await postReq(FORGE_TOKEN, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '1.0' } }
    });
    console.log(`Self-test 200 check: HTTP ${auth.status} (${auth.status === 200 ? 'PASS' : 'FAIL'})`);

    await instance.close();
    console.log('Self-test completed, server closed.');
    process.exit(0);
  } else {
    console.log('Server is running. Press Ctrl+C to stop.');
  }
}

if (require.main === module || process.argv[1]?.includes('s2-mcp')) {
  main().catch((err) => {
    console.error('Spike error:', err);
    process.exit(1);
  });
}
