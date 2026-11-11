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

  constructor() {
    if (vscodeModule?.window?.createStatusBarItem) {
      this.statusBarItem = vscodeModule.window.createStatusBarItem(
        vscodeModule.StatusBarAlignment.Right,
        100
      );
      this.statusBarItem.command = 'forge.openPanel';
      this.setReady();
      this.statusBarItem.show();
    }
  }

  public setReady(): void {
    if (!this.statusBarItem) return;
    this.statusBarItem.text = '$(zap) Forge: Ready';
    this.statusBarItem.tooltip = 'Forge Agent is connected and ready';
  }

  public setWorking(msg = 'Generating...'): void {
    if (!this.statusBarItem) return;
    this.statusBarItem.text = `$(sync~spin) Forge: ${msg}`;
    this.statusBarItem.tooltip = 'Forge Agent is working on an instruction';
  }

  public setPendingReviews(count: number): void {
    if (!this.statusBarItem) return;
    if (count > 0) {
      this.statusBarItem.text = `$(diff) Forge: ${count} hunk${count > 1 ? 's' : ''} pending`;
      this.statusBarItem.tooltip = `${count} proposed diff hunk(s) awaiting review`;
    } else {
      this.setReady();
    }
  }

  public dispose(): void {
    this.statusBarItem?.dispose();
  }
}

export const defaultStatusBar = new ForgeStatusBar();
