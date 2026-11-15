import * as http from 'http';
import { MCP_CONSTANTS } from '../shared/constants';
import { MCPAuthenticator } from './auth';
import { WorkspaceManager } from './workspace';
import { InMemorySymbolIndex } from '../context/symbol-index';
import { ContextBudgetTracker } from '../context/budget';
import { MCP_TOOLS } from './registry';
import { executeReadFile } from './tools/read_file';
import { executeSearchText } from './tools/search_text';
import { executeSearchSymbols } from './tools/search_symbols';
import { executeFindRelated } from './tools/find_related';
import { executeProposeEdit } from './tools/propose_edit';
import { executeProposePatch } from './tools/propose_patch';
import { executeApplyPatchHunk } from './tools/apply_patch_hunk';
import { executeRunTerminalCommand } from './tools/run_terminal_command';

export interface MCPServerOptions {
  port?: number;
  host?: string;
  authenticator?: MCPAuthenticator;
  workspace?: WorkspaceManager;
  symbolIndex?: InMemorySymbolIndex;
  budgetTracker?: ContextBudgetTracker;
}

export class MCPServer {
  private server: http.Server | null = null;
  public readonly port: number;
  public readonly host: string;
  private authenticator?: MCPAuthenticator;
  private workspace: WorkspaceManager;
  private symbolIndex: InMemorySymbolIndex;
  private budgetTracker: ContextBudgetTracker;

  constructor(options?: MCPServerOptions) {
    this.port = options?.port ?? MCP_CONSTANTS.DEFAULT_PORT;
    this.host = options?.host ?? MCP_CONSTANTS.HOST;
    this.authenticator = options?.authenticator;
    this.workspace = options?.workspace ?? new WorkspaceManager();
    this.symbolIndex = options?.symbolIndex ?? new InMemorySymbolIndex(this.workspace.getRoot());
    this.budgetTracker = options?.budgetTracker ?? new ContextBudgetTracker();
  }

  public async start(): Promise<void> {
    if (this.server) {
      return;
    }

    return new Promise((resolve, reject) => {
      this.server = http.createServer(async (req, res) => {
        // Authenticate request if authenticator provided
        if (this.authenticator) {
          const authHeader = req.headers['authorization'];
          const token = authHeader?.replace(/^Bearer\s+/i, '');
          const valid = await this.authenticator.validateToken(token);
          if (!valid) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Unauthorized: Invalid Bearer token' }));
            return;
          }
        }

        const url = new URL(req.url || '/', `http://${this.host}:${this.port}`);

        // Health check endpoint
        if (url.pathname === '/health' && req.method === 'GET') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'healthy', server: MCP_CONSTANTS.SERVER_NAME }));
          return;
        }

        // Tools listing
        if (url.pathname === '/tools' && req.method === 'GET') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          const tools = Object.values(MCP_TOOLS).map(t => ({
            name: t.name,
            description: t.description,
            requireApproval: t.requireApproval
          }));
          res.end(JSON.stringify({ tools }));
          return;
        }

        // Tool invocation RPC: /call-tool
        if (url.pathname === '/call-tool' && req.method === 'POST') {
          let body = '';
          req.on('data', chunk => { body += chunk; });
          req.on('end', async () => {
            try {
              const payload = JSON.parse(body || '{}');
              const { name, arguments: args } = payload;
              const result = await this.handleToolCall(name, args || {});
              res.writeHead(200, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify(result));
            } catch (err: unknown) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }));
            }
          });
          return;
        }

        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
      });

      this.server.listen(this.port, this.host, () => {
        resolve();
      });

      this.server.on('error', (err) => {
        reject(err);
      });
    });
  }

  public async handleToolCall(name: string, args: Record<string, any>): Promise<any> {
    switch (name) {
      case 'read_file':
        return executeReadFile(args as any, this.workspace, this.budgetTracker);
      case 'search_text':
        return executeSearchText(args as any, this.workspace, this.budgetTracker);
      case 'search_symbols':
        return executeSearchSymbols(args as any, this.symbolIndex);
      case 'find_related':
        return executeFindRelated(args as any, this.workspace);
      case 'propose_edit':
        return executeProposeEdit(args as any, this.workspace);
      case 'propose_patch':
        return executeProposePatch(args as any, this.workspace);
      case 'apply_patch_hunk':
        return executeApplyPatchHunk(args as any, this.workspace);
      case 'run_terminal_command':
        return await executeRunTerminalCommand(args as any, this.workspace);
      default:
        return { success: false, error: `Unknown tool: ${name}` };
    }
  }

  public async stop(): Promise<void> {
    if (!this.server) return;
    return new Promise((resolve, reject) => {
      this.server?.close((err) => {
        this.server = null;
        if (err) reject(err);
        else resolve();
      });
    });
  }
}
