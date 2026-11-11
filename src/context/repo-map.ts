import * as fs from 'fs';
import * as path from 'path';
import { WorkspaceManager } from '../mcp/workspace';

export interface RepoMapOptions {
  maxTokens?: number;
  maxFiles?: number;
}

export class RepoMapGenerator {
  constructor(private workspaceManager: WorkspaceManager = new WorkspaceManager()) {}

  /**
   * Generates a compact repository outline containing key files and classes/functions.
   */
  public generateRepoMap(options: RepoMapOptions = {}): string {
    const root = this.workspaceManager.getRoot();
    const maxFiles = options.maxFiles ?? 50;
    const lines: string[] = ['=== Workspace Map ==='];

    const fileList = this.collectFiles(root, root, maxFiles);

    for (const relFile of fileList) {
      const absPath = path.join(root, relFile);
      const outlines = this.extractOutlines(absPath);
      if (outlines.length > 0) {
        lines.push(`${relFile}:`);
        for (const o of outlines.slice(0, 10)) {
          lines.push(`  ${o}`);
        }
      } else {
        lines.push(relFile);
      }
    }

    return lines.join('\n');
  }

  private collectFiles(dir: string, root: string, limit: number): string[] {
    const ignored = new Set(['.git', 'node_modules', '.venv', 'dist', 'out', '__pycache__', '.pytest_cache']);
    const results: string[] = [];

    const walk = (current: string) => {
      if (results.length >= limit) return;
      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(current, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        if (ignored.has(entry.name)) continue;
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (['.py', '.ts', '.js', '.json', '.rst', '.md'].includes(ext)) {
            results.push(path.relative(root, full).replace(/\\/g, '/'));
            if (results.length >= limit) return;
          }
        }
      }
    };

    walk(dir);
    return results;
  }

  private extractOutlines(absPath: string): string[] {
    const outlines: string[] = [];
    let content: string;
    try {
      content = fs.readFileSync(absPath, 'utf-8');
    } catch {
      return outlines;
    }

    const lines = content.split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('def ') || trimmed.startsWith('async def ') || trimmed.startsWith('class ')) {
        outlines.push(trimmed.replace(/:$/, ''));
      } else if (trimmed.startsWith('export class ') || trimmed.startsWith('export function ')) {
        outlines.push(trimmed.replace(/{$/, ''));
      }
      if (outlines.length >= 10) break;
    }

    return outlines;
  }
}

export const defaultRepoMapGenerator = new RepoMapGenerator();
