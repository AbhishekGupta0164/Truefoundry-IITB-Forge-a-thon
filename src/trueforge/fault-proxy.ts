/**
 * Fault-Injection Proxy — Member 1 (Task T8)
 *
 * A lightweight HTTP proxy placed in front of the model endpoint to simulate real-world failures:
 * 1. Connection refused / closed port (ECONNREFUSED / socket destroy)
 * 2. Rate limiting (HTTP 429 with Retry-After header)
 * 3. Authentication failure (HTTP 401 Bad Credentials)
 * 4. Stalled connection (Hang / Request timeout)
 * 5. Mid-stream connection drop (Premature SSE socket termination)
 * 6. Malformed JSON (Corrupted event/response payload)
 *
 * Asserts resilience requirements:
 * - Editor stays responsive
 * - Error taxonomy properly categorizes errors
 * - Backoff and retry count are honored
 * - git status --porcelain remains clean (zero unapproved edits)
 */

import * as http from 'http';
import { AddressInfo, Socket } from 'net';

export type FaultMode =
  | 'none'
  | 'refused'
  | 'rate_limit'
  | 'auth_error'
  | 'stall'
  | 'stream_drop'
  | 'malformed_json';

export interface FaultProxyOptions {
  targetUrl?: string;
  defaultFault?: FaultMode;
  rateLimitRetryAfterSec?: number;
  stallTimeoutMs?: number;
}

export interface RequestRecord {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  timestamp: number;
}

export class FaultInjectionProxy {
  private server: http.Server | null = null;
  private port: number = 0;
  private currentFault: FaultMode = 'none';
  private rateLimitRetryAfterSec: number = 2;
  private stallTimeoutMs: number = 10000;
  private openSockets: Set<Socket> = new Set();

  public requestCount: number = 0;
  public history: RequestRecord[] = [];

  constructor(options: FaultProxyOptions = {}) {
    this.currentFault = options.defaultFault || 'none';
    if (options.rateLimitRetryAfterSec) {
      this.rateLimitRetryAfterSec = options.rateLimitRetryAfterSec;
    }
    if (options.stallTimeoutMs) {
      this.stallTimeoutMs = options.stallTimeoutMs;
    }
  }

  public setFault(fault: FaultMode): void {
    this.currentFault = fault;
  }

  public getFault(): FaultMode {
    return this.currentFault;
  }

  public resetStats(): void {
    this.requestCount = 0;
    this.history = [];
  }

  public async start(preferredPort: number = 0): Promise<number> {
    if (this.server) {
      return this.port;
    }

    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        this.handleRequest(req, res);
      });

      this.server.on('connection', (socket: Socket) => {
        this.openSockets.add(socket);
        socket.on('close', () => {
          this.openSockets.delete(socket);
        });
      });

      this.server.listen(preferredPort, '127.0.0.1', () => {
        const addr = this.server?.address() as AddressInfo;
        this.port = addr.port;
        resolve(this.port);
      });

      this.server.on('error', (err) => {
        reject(err);
      });
    });
  }

  public async stop(): Promise<void> {
    for (const socket of this.openSockets) {
      socket.destroy();
    }
    this.openSockets.clear();

    if (!this.server) {
      return;
    }

    return new Promise((resolve) => {
      this.server?.close(() => {
        this.server = null;
        resolve();
      });
    });
  }

  public getUrl(): string {
    if (!this.port) {
      throw new Error('Fault proxy is not running');
    }
    return `http://127.0.0.1:${this.port}`;
  }

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    this.requestCount++;
    this.history.push({
      method: req.method || 'GET',
      url: req.url || '/',
      headers: req.headers,
      timestamp: Date.now()
    });

    switch (this.currentFault) {
      case 'refused': {
        // Destroy the socket abruptly to simulate connection failure / closed port
        req.socket.destroy();
        break;
      }

      case 'rate_limit': {
        res.writeHead(429, {
          'Content-Type': 'application/json',
          'Retry-After': String(this.rateLimitRetryAfterSec)
        });
        res.end(
          JSON.stringify({
            error: {
              code: 'RATE_LIMIT_EXCEEDED',
              message: 'Rate limit exceeded. Please back off.',
              retryAfter: this.rateLimitRetryAfterSec
            }
          })
        );
        break;
      }

      case 'auth_error': {
        res.writeHead(401, {
          'Content-Type': 'application/json'
        });
        res.end(
          JSON.stringify({
            error: {
              code: 'UNAUTHORIZED',
              message: 'Invalid API key or authentication token provided.'
            }
          })
        );
        break;
      }

      case 'stall': {
        // Do not respond; let caller time out or wait
        setTimeout(() => {
          if (!res.writableEnded) {
            res.writeHead(504, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: { message: 'Gateway timeout' } }));
          }
        }, this.stallTimeoutMs);
        break;
      }

      case 'stream_drop': {
        // Start streaming SSE events, then abort connection mid-stream
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive'
        });
        res.write('event: session.turn.start\ndata: {"turn_id": "turn-1"}\n\n');
        setTimeout(() => {
          req.socket.destroy();
        }, 50);
        break;
      }

      case 'malformed_json': {
        res.writeHead(200, {
          'Content-Type': 'application/json'
        });
        res.end('{"status": "ok", "data": { "session": '); // Truncated invalid JSON
        break;
      }

      case 'none':
      default: {
        // Default healthy mock session response
        res.writeHead(200, {
          'Content-Type': 'application/json'
        });
        res.end(
          JSON.stringify({
            data: {
              id: 'mock-session-healthy-001',
              status: 'active'
            }
          })
        );
        break;
      }
    }
  }
}
