/**
 * Forge Workspace MCP Server (Stage 2)
 *
 * Implements MCP over Streamable HTTP and SSE at 127.0.0.1:8765.
 * Enforces Bearer token authentication on /mcp, /sse, and /messages.
 * Integrates all 9 workspace tools with security and context budgets.
 */

import * as http from 'http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { MCP_CONSTANTS } from '../shared/constants';
import { WorkspaceManager } from './workspace';
import { ContextBudgetTracker } from '../context/budget';
import { PatchStore, defaultPatchStore } from '../review/store';
import { MCPAuthenticator } from './auth';
import { registerAllTools } from './registry';

export interface McpServerOptions {
  port?: number;
  token?: string;
  workspaceRoot?: string;
  workspaceManager?: WorkspaceManager;
  budgetTracker?: ContextBudgetTracker;
  patchStore?: PatchStore;
}

export interface MCPServerInfo {
  port: number;
  host: string;
  endpoint: string;
  serverName: string;
}

export class ForgeMcpServer {
  private server: http.Server | null = null;
  private mcp: McpServer;
  private token: string;
  private port: number;
  private workspace: WorkspaceManager;
  private budgetTracker: ContextBudgetTracker;
  private patchStore: PatchStore;
  private sseTransports = new Map<string, SSEServerTransport>();
  private streamableTransport: StreamableHTTPServerTransport | null = null;
  private running = false;
  private authenticator?: MCPAuthenticator;

  constructor(options: McpServerOptions = {}, authenticator?: MCPAuthenticator) {
    this.port = options.port ?? MCP_CONSTANTS.DEFAULT_PORT;
    this.token = options.token ?? (process.env.FORGE_MCP_TOKEN || 'forge-dev-token-secret-12345');
    this.workspace = options.workspaceManager ?? new WorkspaceManager(options.workspaceRoot);
    this.budgetTracker = options.budgetTracker ?? new ContextBudgetTracker();
    this.patchStore = options.patchStore ?? defaultPatchStore;
    this.authenticator = authenticator;

    this.mcp = new McpServer(
      {
        name: MCP_CONSTANTS.SERVER_NAME,
        version: '0.1.0'
      },
      {
        capabilities: {
          tools: {
            listChanged: true
          }
        }
      }
    );

    this.registerTools();
  }

  private registerTools(): void {
    // Register all tools: ping, search_text, search_symbols, read_file, find_related,
    // propose_patch, propose_edit, apply_patch_hunk, and run_terminal_command
    registerAllTools(this.mcp, this.workspace, this.budgetTracker, this.patchStore);
  }

  public async start(options: McpServerOptions = {}): Promise<void> {
    if (this.running) {
      return;
    }

    if (options.port) {
      this.port = options.port;
    }
    if (options.token) {
      this.token = options.token;
    }

    return new Promise((resolve, reject) => {
      this.server = http.createServer(async (req, res) => {
        try {
          const url = new URL(req.url ?? '/', `http://${req.headers.host || MCP_CONSTANTS.HOST}`);

          // Auth check on /mcp, /sse, and /messages
          const authHeader = req.headers.authorization;
          let providedToken: string | undefined;
          if (authHeader && authHeader.startsWith('Bearer ')) {
            providedToken = authHeader.slice(7).trim();
          }
          if (!providedToken) {
            providedToken = url.searchParams.get('token') || undefined;
          }

          let isAuthed = false;
          if (providedToken) {
            if (this.authenticator) {
              // Always use authenticator when available (SecretStorage-based token)
              isAuthed = await this.authenticator.validateToken(providedToken);
            } else {
              // Fallback: compare directly against static token
              isAuthed = providedToken === this.token;
            }
          }

          if (!isAuthed) {
            res.writeHead(401, {
              'Content-Type': 'application/json',
              'WWW-Authenticate': 'Bearer realm="Forge"'
            });
            res.end(JSON.stringify({ error: 'Unauthorized: missing or invalid bearer token' }));
            return;
          }

          // SSE endpoints: /sse or GET /mcp
          if (url.pathname === '/sse' || (url.pathname === '/mcp' && req.method === 'GET')) {
            const transport = new SSEServerTransport('/messages', res);
            const sessionId = transport.sessionId;
            this.sseTransports.set(sessionId, transport);

            transport.onclose = () => {
              this.sseTransports.delete(sessionId);
            };

            // Connect a session MCP instance for this SSE client
            const sessionMcp = new McpServer(
              { name: MCP_CONSTANTS.SERVER_NAME, version: '0.1.0' },
              { capabilities: { tools: { listChanged: true } } }
            );
            registerAllTools(sessionMcp, this.workspace, this.budgetTracker, this.patchStore);

            await sessionMcp.connect(transport);
            return;
          }

          // SSE message endpoint
          if (url.pathname === '/messages') {
            const sessionId = url.searchParams.get('sessionId');
            const transport = sessionId ? this.sseTransports.get(sessionId) : undefined;
            if (!transport) {
              res.writeHead(404, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'Session not found' }));
              return;
            }
            await transport.handlePostMessage(req, res);
            return;
          }

          // Streamable HTTP endpoint: POST /mcp (stateless — new transport per request)
          if (url.pathname === '/mcp' && req.method === 'POST') {
            const transport = new StreamableHTTPServerTransport({
              sessionIdGenerator: undefined, // stateless mode
              enableJsonResponse: true
            });
            const sessionMcp = new McpServer(
              { name: MCP_CONSTANTS.SERVER_NAME, version: '0.1.0' },
              { capabilities: { tools: { listChanged: true } } }
            );
            registerAllTools(sessionMcp, this.workspace, this.budgetTracker, this.patchStore);
            await sessionMcp.connect(transport);
            await transport.handleRequest(req, res);
            return;
          }

          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `Not found: ${url.pathname}` }));
        } catch (err: any) {
          if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err?.message || String(err) }));
          }
        }
      });

      this.server.on('error', (err) => {
        this.running = false;
        reject(err);
      });

      this.server.listen(this.port, MCP_CONSTANTS.HOST, () => {
        this.running = true;
        resolve();
      });
    });
  }

  public async stop(): Promise<void> {
    if (!this.running && !this.server) {
      return;
    }

    try {
      if (this.streamableTransport) {
        await this.streamableTransport.close();
      }
    } catch {
      // ignore
    }

    try {
      await this.mcp.close();
    } catch {
      // ignore
    }

    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server?.close(() => resolve());
      });
      this.server = null;
    }

    this.streamableTransport = null;
    this.running = false;
  }

  public getToken(): string {
    return this.token;
  }

  public getPort(): number {
    return this.port;
  }

  public getHost(): string {
    return MCP_CONSTANTS.HOST;
  }

  public isRunning(): boolean {
    return this.running;
  }

  public getHttpServer(): http.Server | null {
    return this.server;
  }
}

/**
 * Adapter class preserving MCPServerManager API for VS Code extension lifecycle and unit tests.
 */
export class MCPServerManager {
  private forgeServer: ForgeMcpServer;

  constructor(
    authenticator?: MCPAuthenticator,
    workspaceManager: WorkspaceManager = new WorkspaceManager(),
    budgetTracker: ContextBudgetTracker = new ContextBudgetTracker(),
    patchStore: PatchStore = defaultPatchStore
  ) {
    this.forgeServer = new ForgeMcpServer(
      {
        workspaceManager,
        budgetTracker,
        patchStore
      },
      authenticator
    );
  }

  public isRunning(): boolean {
    return this.forgeServer.isRunning();
  }

  public getPort(): number {
    return this.forgeServer.getPort();
  }

  public getHost(): string {
    return this.forgeServer.getHost();
  }

  public getHttpServer(): http.Server | null {
    return this.forgeServer.getHttpServer();
  }

  public async getToken(): Promise<string> {
    return this.forgeServer.getToken();
  }

  public async start(options: { port?: number; host?: string } = {}): Promise<MCPServerInfo> {
    await this.forgeServer.start({ port: options.port });
    return {
      port: this.forgeServer.getPort(),
      host: this.forgeServer.getHost(),
      endpoint: '/mcp',
      serverName: MCP_CONSTANTS.SERVER_NAME
    };
  }

  public async stop(): Promise<void> {
    await this.forgeServer.stop();
  }
}
