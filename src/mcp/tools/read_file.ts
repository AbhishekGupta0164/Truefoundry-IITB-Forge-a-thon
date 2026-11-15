import * as fs from 'fs';
import { WorkspaceManager } from '../workspace';
import { ContextBudgetTracker } from '../../context/budget';
import { sanitizeToolOutput } from '../sanitize';

export interface ReadFileInput {
  file_path: string;
  start_line?: number;
  end_line?: number;
  reason: string;
}

export function executeReadFile(
  input: ReadFileInput,
  workspace: WorkspaceManager,
  budgetTracker?: ContextBudgetTracker
): { success: boolean; content?: string; error?: string } {
  if (!input.reason || typeof input.reason !== 'string' || input.reason.trim().length === 0) {
    return { success: false, error: 'A short reason must be provided when reading a file' };
  }

  try {
    const safePath = workspace.resolveSafePath(input.file_path);
    if (!fs.existsSync(safePath)) {
      return { success: false, error: `File not found: ${input.file_path}` };
    }

    const fileContent = fs.readFileSync(safePath, 'utf8');
    const lines = fileContent.split('\n');

    const start = input.start_line ? Math.max(1, input.start_line) : 1;
    const end = input.end_line ? Math.min(lines.length, input.end_line) : Math.min(lines.length, start + 199);
    const lineCount = end - start + 1;

    if (budgetTracker) {
      budgetTracker.recordFileRead(input.file_path, lineCount);
    }

    const selectedLines = lines.slice(start - 1, end).map((l, idx) => `${start + idx} | ${l}`).join('\n');
    const sanitized = sanitizeToolOutput(selectedLines);

    return { success: true, content: sanitized };
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}
