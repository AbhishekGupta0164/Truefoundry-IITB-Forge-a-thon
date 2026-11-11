/**
 * Forge Workspace MCP Server (Stage 1 M2)
 *
 * Implements MCP over HTTP SSE at 127.0.0.1:8765.
 * Enforces Bearer token authentication on /mcp and /sse.
 */

import * as http from 'http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { z } from 'zod';
import { MCP_CONSTANTS } from '../shared/constants';
import { WorkspaceManager } from './workspace';
import { applyHunkToFile } from '../review/apply';

export interface McpServerOptions {
  port?: number;
  token?: string;
  workspaceRoot?: string;
}

export class ForgeMcpServer {
  private server: http.Server | null = null;
  private mcp: McpServer;
  private token: string;
  private port: number;
  private workspace: WorkspaceManager;
  private transports = new Map<string, SSEServerTransport>();

  constructor(options: McpServerOptions = {}) {
    this.port = options.port ?? MCP_CONSTANTS.DEFAULT_PORT;
    this.token = options.token ?? (process.env.FORGE_MCP_TOKEN || 'forge-secret-token');
    this.workspace = new WorkspaceManager(options.workspaceRoot);

    this.mcp = new McpServer({
      name: MCP_CONSTANTS.SERVER_NAME,
      version: '0.1.0'
    });

    this.registerTools();
  }

  private registerTools(): void {
    // S2: ping tool
    this.mcp.tool(
      'ping',
      'Minimal connectivity test tool. Returns pong.',
      {},
      async () => {
        return { content: [{ type: 'text', text: 'pong' }] };
      }
    );

    // S3/S4: apply_patch_hunk tool
    this.mcp.tool(
      'apply_patch_hunk',
      'Apply a unified diff hunk to a file. Requires user approval.',
      {
        hunkId: z.string().describe('Unique ID of the hunk'),
        file: z.string().describe('Target relative file path'),
        oldStart: z.number().describe('1-based line number where old chunk starts'),
        oldLines: z.number().describe('Line count in old chunk'),
        newStart: z.number().describe('1-based line number where new chunk starts'),
        newLines: z.number().describe('Line count in new chunk'),
        content: z.string().describe('Diff hunk content')
      },
      async (args) => {
        const absPath = this.workspace.resolveSafePath(args.file);
        applyHunkToFile(absPath, {
          id: args.hunkId,
          file: args.file,
          oldStart: args.oldStart,
          oldLines: args.oldLines,
          newStart: args.newStart,
          newLines: args.newLines,
          content: args.content
        });
        return { content: [{ type: 'text', text: `Hunk ${args.hunkId} applied successfully to ${args.file}` }] };
      }
    );
  }

  public async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer(async (req, res) => {
        const url = new URL(req.url ?? '/', `http://${req.headers.host || '127.0.0.1'}`);

        // Auth check for /mcp, /sse, and /messages
        const authHeader = req.headers.authorization;
        const queryToken = url.searchParams.get('token');
        const isAuthed =
          (authHeader && authHeader === `Bearer ${this.token}`) ||
          (queryToken && queryToken === this.token);

        if (!isAuthed) {
          res.writeHead(401, {
            'Content-Type': 'application/json',
            'WWW-Authenticate': 'Bearer realm="Forge"'
          });
          res.end(JSON.stringify({ error: 'Unauthorized: valid Bearer token required' }));
          return;
        }

        if (url.pathname === '/sse' || url.pathname === '/mcp') {
          // SSE connect endpoint
          const transport = new SSEServerTransport('/messages', res);
          const sessionId = transport.sessionId;
          this.transports.set(sessionId, transport);

          transport.onclose = () => {
            this.transports.delete(sessionId);
          };

          await this.mcp.connect(transport);
          return;
        }

        if (url.pathname === '/messages') {
          const sessionId = url.searchParams.get('sessionId');
          const transport = sessionId ? this.transports.get(sessionId) : undefined;
          if (!transport) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Session not found' }));
            return;
          }
          await transport.handlePostMessage(req, res);
          return;
        }

        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
      });

      this.server.on('error', reject);
      this.server.listen(this.port, '127.0.0.1', () => {
        resolve();
      });
    });
  }

  public async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }

  public getToken(): string {
    return this.token;
  }
}
