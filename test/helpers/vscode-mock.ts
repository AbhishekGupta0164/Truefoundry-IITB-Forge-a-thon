/**
 * Mock vscode module for Vitest test execution
 */

export interface MockSecretStorage {
  get(key: string): Promise<string | undefined>;
  store(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

export class InMemorySecretStorage implements MockSecretStorage {
  private secrets = new Map<string, string>();

  async get(key: string): Promise<string | undefined> {
    return this.secrets.get(key);
  }

  async store(key: string, value: string): Promise<void> {
    this.secrets.set(key, value);
  }

  async delete(key: string): Promise<void> {
    this.secrets.delete(key);
  }
}

export const workspace = {
  workspaceFolders: [
    {
      uri: { fsPath: process.cwd(), scheme: 'file' },
      name: 'root',
      index: 0
    }
  ],
  getConfiguration: (_section?: string) => ({
    get: <T>(_key: string, defaultValue?: T): T => defaultValue as T
  }),
  applyEdit: async (_edit: any) => true,
  openTextDocument: async (_pathOrUri: any) => ({
    getText: () => '',
    version: 1,
    lineCount: 10,
    save: async () => true
  })
};

export const window = {
  showInformationMessage: async () => undefined,
  showErrorMessage: async () => undefined,
  showWarningMessage: async () => undefined
};

export const commands = {
  registerCommand: (_command: string, _callback: (...args: any[]) => any) => ({
    dispose: () => {}
  })
};

export const env = {
  clipboard: {
    writeText: async (_text: string) => undefined,
    readText: async () => ''
  }
};

export class WorkspaceEdit {
  private edits: any[] = [];
  replace(uri: any, range: any, newText: string) {
    this.edits.push({ uri, range, newText });
  }
  insert(uri: any, position: any, newText: string) {
    this.edits.push({ uri, position, newText });
  }
  delete(uri: any, range: any) {
    this.edits.push({ uri, range });
  }
}

export class Uri {
  constructor(public fsPath: string, public scheme = 'file') {}
  static file(f: string) {
    return new Uri(f, 'file');
  }
}

export class Range {
  constructor(
    public startLine: number,
    public startChar: number,
    public endLine: number,
    public endChar: number
  ) {}
}

export class Position {
  constructor(public line: number, public character: number) {}
}
