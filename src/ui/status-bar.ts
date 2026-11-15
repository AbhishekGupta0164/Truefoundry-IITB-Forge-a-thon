/**
 * Forge Status Bar Component
 *
 * Displays "Agent-modified files: N" as required by Stage 3 Section 11,
 * tracking distinct files modified by accepted agent edits.
 */

import type * as vscodeTypes from 'vscode';

let vscodeModule: typeof vscodeTypes | undefined;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  vscodeModule = require('vscode');
} catch {
  // Running outside VS Code
}

export class ForgeStatusBar {
  private statusBarItem?: vscodeTypes.StatusBarItem;
  private currentCount = 0;
  private currentText = '';

  constructor() {
    if (vscodeModule?.window?.createStatusBarItem) {
      this.statusBarItem = vscodeModule.window.createStatusBarItem(
        vscodeModule.StatusBarAlignment.Right,
        100
      );
      this.statusBarItem.command = 'forge.openPanel';
      this.setAgentModifiedFiles(0);
      this.statusBarItem.show();
    } else {
      this.setAgentModifiedFiles(0);
    }
  }

  /**
   * Set the number of distinct agent-modified files (Stage 3 Item 11).
   */
  public setAgentModifiedFiles(count: number): void {
    this.currentCount = count;
    this.currentText = `Agent-modified files: ${count}`;
    if (this.statusBarItem) {
      this.statusBarItem.text = `$(file-code) ${this.currentText}`;
      this.statusBarItem.tooltip = `${count} distinct file(s) modified by accepted agent edits`;
    }
  }

  public getModifiedFilesCount(): number {
    return this.currentCount;
  }

  public getText(): string {
    return this.currentText;
  }

  public setReady(): void {
    if (!this.statusBarItem) return;
    this.setAgentModifiedFiles(this.currentCount);
  }

  public setWorking(msg = 'Generating...'): void {
    if (!this.statusBarItem) return;
    this.statusBarItem.text = `$(sync~spin) Forge: ${msg}`;
    this.statusBarItem.tooltip = 'Forge Agent is working on an instruction';
  }

  public setPendingReviews(count: number): void {
    if (!this.statusBarItem) return;
    if (count > 0) {
      this.statusBarItem.text = `$(diff) Forge: ${count} hunk${count > 1 ? 's' : ''} pending | Agent-modified files: ${this.currentCount}`;
      this.statusBarItem.tooltip = `${count} proposed diff hunk(s) awaiting review`;
    } else {
      this.setAgentModifiedFiles(this.currentCount);
    }
  }

  public dispose(): void {
    this.statusBarItem?.dispose();
  }
}

export const defaultStatusBar = new ForgeStatusBar();
