import * as fs from 'fs';
import type * as vscodeTypes from 'vscode';
import { PatchStore, defaultPatchStore } from './store';

let vscodeModule: typeof vscodeTypes | undefined;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  vscodeModule = require('vscode');
} catch {
  // Running outside VS Code
}

export interface TaskSnapshot {
  taskId: string;
  files: Map<string, string>; // absPath -> initial content before task
  timestamp: number;
}

export class UndoManager {
  private snapshots = new Map<string, TaskSnapshot>();
  private fileBackups = new Map<string, string>(); // absPath -> original content

  constructor(private patchStore: PatchStore = defaultPatchStore) {}

  /**
   * Record the original state of a file before any modifications.
   */
  public recordInitialState(absPath: string, content?: string): void {
    if (!this.fileBackups.has(absPath)) {
      const initial = content !== undefined ? content : (fs.existsSync(absPath) ? fs.readFileSync(absPath, 'utf-8') : '');
      this.fileBackups.set(absPath, initial);
    }
  }

  /**
   * Start tracking a task snapshot with an identifier.
   */
  public beginTask(taskId: string): void {
    if (!this.snapshots.has(taskId)) {
      this.snapshots.set(taskId, {
        taskId,
        files: new Map(),
        timestamp: Date.now()
      });
    }
  }

  /**
   * Record a file's state for a specific task.
   */
  public trackFileForTask(taskId: string, absPath: string, content: string): void {
    const task = this.snapshots.get(taskId);
    if (task && !task.files.has(absPath)) {
      task.files.set(absPath, content);
    }
    this.recordInitialState(absPath, content);
  }

  /**
   * Undo a whole task: reverts all files modified in the task to their initial snapshot.
   */
  public async undoTask(taskId?: string): Promise<{ success: boolean; revertedFiles: string[] }> {
    const revertedFiles: string[] = [];

    if (taskId && this.snapshots.has(taskId)) {
      const snapshot = this.snapshots.get(taskId)!;
      for (const [filePath, initialContent] of snapshot.files.entries()) {
        await this.restoreFile(filePath, initialContent);
        revertedFiles.push(filePath);
      }
      this.snapshots.delete(taskId);
    } else {
      // Revert all tracked file backups
      for (const [filePath, initialContent] of this.fileBackups.entries()) {
        await this.restoreFile(filePath, initialContent);
        revertedFiles.push(filePath);
      }
      this.fileBackups.clear();
      this.snapshots.clear();
    }

    // Also clear or reset patches in patchStore
    this.patchStore.clear();

    return {
      success: true,
      revertedFiles
    };
  }

  /**
   * Helper to write back content and notify VS Code if active.
   */
  private async restoreFile(filePath: string, content: string): Promise<void> {
    try {
      if (vscodeModule?.workspace && typeof vscodeModule.workspace.applyEdit === 'function') {
        const fileUri = vscodeModule.Uri.file(filePath);
        const edit = new vscodeModule.WorkspaceEdit();
        const doc = await vscodeModule.workspace.openTextDocument(fileUri);
        const fullRange = new vscodeModule.Range(
          new vscodeModule.Position(0, 0),
          new vscodeModule.Position(doc.lineCount || 1000, 0)
        );
        edit.replace(fileUri, fullRange, content);
        await vscodeModule.workspace.applyEdit(edit);
        if (doc && typeof (doc as any).save === 'function') {
          await (doc as any).save();
        }
      }
    } catch {
      // In non-VS Code or test environment, write directly to disk
    }

    fs.writeFileSync(filePath, content, 'utf-8');
  }

  public clear(): void {
    this.snapshots.clear();
    this.fileBackups.clear();
  }
}

export const defaultUndoManager = new UndoManager();
