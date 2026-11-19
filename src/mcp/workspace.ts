import * as fs from 'fs';
import * as path from 'path';
import type * as vscodeTypes from 'vscode';
import { isPathSafe } from '../shared/validation';

let vscodeModule: typeof vscodeTypes | undefined;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  vscodeModule = require('vscode');
} catch {
  // Running outside VS Code extension host
}

export class WorkspaceManager {
  private workspaceRoot: string;

  constructor(customRoot?: string) {
    if (customRoot) {
      this.workspaceRoot = path.resolve(customRoot);
    } else {
      let folders: readonly vscodeTypes.WorkspaceFolder[] | undefined;
      try {
        folders = vscodeModule?.workspace?.workspaceFolders;
      } catch {
        // Fallback for non-VS Code environments
      }
      this.workspaceRoot = folders && folders.length > 0 ? folders[0].uri.fsPath : process.cwd();
    }
  }

  public getRoot(): string {
    return this.workspaceRoot;
  }

  public resolveSafePath(relativePath: string): string {
    if (!relativePath || typeof relativePath !== 'string') {
      throw new Error(`Security violation: Invalid path argument`);
    }

    if (!isPathSafe(relativePath, this.workspaceRoot)) {
      throw new Error(`Security violation: Access to '${relativePath}' is denied`);
    }

    const fullPath = path.resolve(this.workspaceRoot, relativePath);
    const realRoot = fs.existsSync(this.workspaceRoot)
      ? fs.realpathSync(this.workspaceRoot)
      : path.resolve(this.workspaceRoot);

    // If target exists, verify realpath is within workspace root
    if (fs.existsSync(fullPath)) {
      const realPath = fs.realpathSync(fullPath);
      const lowerRealPath = realPath.toLowerCase();
      const lowerRealRoot = realRoot.toLowerCase();
      if (lowerRealPath !== lowerRealRoot && !lowerRealPath.startsWith(lowerRealRoot + path.sep)) {
        throw new Error(`Security violation: Symlink escape detected for '${relativePath}'`);
      }
      return fullPath;
    }

    // If target does not exist, check existing parent directories for symlink escape
    let currentDir = path.dirname(fullPath);
    while (!fs.existsSync(currentDir)) {
      const parentDir = path.dirname(currentDir);
      if (parentDir === currentDir) {
        break;
      }
      currentDir = parentDir;
    }

    if (fs.existsSync(currentDir)) {
      const realParent = fs.realpathSync(currentDir);
      const lowerRealParent = realParent.toLowerCase();
      const lowerRealRoot = realRoot.toLowerCase();
      if (lowerRealParent !== lowerRealRoot && !lowerRealParent.startsWith(lowerRealRoot + path.sep)) {
        throw new Error(`Security violation: Symlinked parent directory escape detected for '${relativePath}'`);
      }
    }

    return fullPath;
  }
}
