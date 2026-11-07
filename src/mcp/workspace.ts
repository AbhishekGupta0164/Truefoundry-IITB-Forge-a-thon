import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { isPathSafe } from '../shared/validation';

export class WorkspaceManager {
  private workspaceRoot: string;

  constructor(customRoot?: string) {
    if (customRoot) {
      this.workspaceRoot = path.resolve(customRoot);
    } else {
      const folders = vscode.workspace.workspaceFolders;
      this.workspaceRoot = folders && folders.length > 0 ? folders[0].uri.fsPath : process.cwd();
    }
  }

  public getRoot(): string {
    return this.workspaceRoot;
  }

  public resolveSafePath(relativePath: string): string {
    if (!isPathSafe(relativePath, this.workspaceRoot)) {
      throw new Error(`Security violation: Access to '${relativePath}' is denied`);
    }

    const fullPath = path.resolve(this.workspaceRoot, relativePath);

    // Symlink resolution check
    if (fs.existsSync(fullPath)) {
      const realPath = fs.realpathSync(fullPath);
      const realRoot = fs.realpathSync(this.workspaceRoot);
      if (!realPath.startsWith(realRoot + path.sep) && realPath !== realRoot) {
        throw new Error(`Security violation: Symlink escape detected for '${relativePath}'`);
      }
    }

    return fullPath;
  }
}
