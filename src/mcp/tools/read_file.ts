import * as fs from 'fs';
import { WorkspaceManager } from '../workspace';
import { ContextBudgetTracker } from '../../context/budget';
import { sanitizeToolOutput } from '../sanitize';
import { RETRIEVED_CONTEXT_BUDGET } from '../../shared/constants';

export interface ReadFileParams {
  path: string;
  start?: number;
  end?: number;
  reason?: string;
}

export interface ReadFileResult {
  filePath: string;
  startLine: number;
  endLine: number;
  totalLines: number;
  lines: string[];
  rawText: string;
}

export async function executeReadFile(
  params: ReadFileParams,
  workspaceManager: WorkspaceManager,
  budgetTracker: ContextBudgetTracker
): Promise<ReadFileResult> {
  const { path: relativePath, start = 1, end, reason: _reason } = params;

  if (!relativePath || typeof relativePath !== 'string') {
    throw new Error('File path must be a non-empty string');
  }

  // Resolve safe path or throw security violation
  const absPath = workspaceManager.resolveSafePath(relativePath);

  if (!fs.existsSync(absPath)) {
    throw new Error(`File not found: ${relativePath}`);
  }

  const fileContent = fs.readFileSync(absPath, 'utf-8');
  const allLines = fileContent.split(/\r?\n/);
  const totalLines = allLines.length;

  const startLine = Math.max(1, Math.floor(start));
  if (end !== undefined && (Math.floor(end) - startLine + 1) > RETRIEVED_CONTEXT_BUDGET.MAX_LINES_PER_READ) {
    throw new Error(
      `Read request exceeds maximum limit of ${RETRIEVED_CONTEXT_BUDGET.MAX_LINES_PER_READ} lines (requested: ${Math.floor(end) - startLine + 1})`
    );
  }

  const endLine = end !== undefined
    ? Math.min(totalLines, Math.floor(end))
    : Math.min(totalLines, startLine + RETRIEVED_CONTEXT_BUDGET.MAX_LINES_PER_READ - 1);

  if (startLine > totalLines && totalLines > 0) {
    throw new Error(`Start line ${startLine} is beyond end of file (${totalLines} lines)`);
  }

  const requestedLineCount = Math.max(0, endLine - startLine + 1);
  if (requestedLineCount > RETRIEVED_CONTEXT_BUDGET.MAX_LINES_PER_READ) {
    throw new Error(
      `Read request exceeds maximum limit of ${RETRIEVED_CONTEXT_BUDGET.MAX_LINES_PER_READ} lines (requested: ${requestedLineCount})`
    );
  }

  const selectedLines = allLines.slice(startLine - 1, endLine);
  const chunkText = selectedLines.join('\n');
  const tokenCount = Math.ceil(chunkText.length / 4);

  // Apply context budget accounting (file count, token budget, line limit)
  budgetTracker.recordFileRead(relativePath, requestedLineCount, tokenCount);

  const formattedLines = selectedLines.map((line, idx) => {
    const lineNum = startLine + idx;
    return `${lineNum.toString().padStart(4, ' ')} | ${line}`;
  });

  const header = `File: ${relativePath} (lines ${startLine}-${endLine} of ${totalLines})`;
  const body = `${header}\n${formattedLines.join('\n')}`;

  return {
    filePath: relativePath,
    startLine,
    endLine,
    totalLines,
    lines: selectedLines,
    rawText: sanitizeToolOutput(body)
  };
}
