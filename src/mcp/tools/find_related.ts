import * as fs from 'fs';
import * as path from 'path';
import { WorkspaceManager } from '../workspace';

export interface FindRelatedInput {
  file_path: string;
}

export function executeFindRelated(
  input: FindRelatedInput,
  workspace: WorkspaceManager
): { success: boolean; related: string[]; error?: string } {
  try {
    const root = workspace.getRoot();
    const base = path.basename(input.file_path, path.extname(input.file_path));
    const related: string[] = [];

    const candidates = [
      `tests/test_${base}.py`,
      `test/test_${base}.py`,
      `test/unit/${base}.test.ts`,
      `tests/${base}_test.py`,
      `docs/${base}.md`,
      `docs/api/${base}.md`
    ];

    for (const cand of candidates) {
      const fullCand = path.join(root, cand);
      if (fs.existsSync(fullCand)) {
        related.push(cand);
      }
    }

    return { success: true, related };
  } catch (err: unknown) {
    return { success: false, related: [], error: err instanceof Error ? err.message : String(err) };
  }
}
