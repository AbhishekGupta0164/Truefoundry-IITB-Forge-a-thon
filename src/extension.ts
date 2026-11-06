import * as vscode from 'vscode';

export function activate(context: vscode.ExtensionContext) {
  console.log('Congratulations, your extension "truefoundry-forgeathon" is now active!');

  const disposable = vscode.commands.registerCommand('truefoundry-forgeathon.helloWorld', () => {
    vscode.window.showInformationMessage('Hello from TrueFoundry Forge-a-thon!');
  });

  context.subscriptions.push(disposable);
}

export function deactivate() {}
