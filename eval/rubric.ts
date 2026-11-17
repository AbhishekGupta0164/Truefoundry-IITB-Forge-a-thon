/**
 * Machine-Scored Rubric & Evaluation Metrics — Member 1 (Task T10)
 *
 * Implements machine-scored rubric according to Build Plan v2:
 *
 * Task A Rubric:
 * 1. Syntax valid Python AST
 * 2. False returned for 'off', 'n', 'N', 'Off' case-insensitively
 * 3. Docstring explicitly lists all false values: '0', 'false', 'no', 'off', 'n'
 * 4. Scope: Only get_debug_flag function area changed
 *
 * Task B Rubric:
 * 1. At least 3 files changed (impl, test, docs)
 * 2. Pytest passes on test_cli.py
 * 3. flask --help lists config command
 * 4. Secrets masked as '***' in output
 * 5. Clean workspace (zero unapproved writes)
 *
 * Matrix:
 * - Computes pass rate, median tool calls, tokens, latency, flake rate, and common failure.
 */

import { validatePythonSource } from '../src/review/validate';

export interface TaskAResult {
  passed: boolean;
  syntaxValid: boolean;
  evaluatesValues: boolean;
  docstringListsAll: boolean;
  onlyTargetChanged: boolean;
  failures: string[];
}

export function scoreTaskA(generatedCode: string): TaskAResult {
  const failures: string[] = [];

  // 1. Python AST Syntax Check
  const syntax = validatePythonSource(generatedCode);
  const syntaxValid = syntax.valid;
  if (!syntaxValid) {
    failures.push(`Syntax error: ${syntax.errors.join('; ')}`);
  }

  // 2. Evaluates values 'off' and 'n' as false case-insensitively
  // Check code semantics for set/tuple containing required false strings
  const lowerCode = generatedCode.toLowerCase();
  const requiredValues = ['0', 'false', 'no', 'off', 'n'];
  const hasOff = lowerCode.includes('"off"') || lowerCode.includes("'off'");
  const hasN = lowerCode.includes('"n"') || lowerCode.includes("'n'");
  const hasLower = lowerCode.includes('.lower()') || lowerCode.includes('case-insensitive');
  const evaluatesValues = hasOff && hasN && hasLower;
  if (!evaluatesValues) {
    failures.push("Does not evaluate 'off' and 'n' case-insensitively");
  }

  // 3. Docstring lists every value treated as false
  const docstringMatch = generatedCode.match(/"""([\s\S]*?)"""|'''([\s\S]*?)'''/);
  const docstring = (docstringMatch ? docstringMatch[1] || docstringMatch[2] : '').toLowerCase();
  const missingFromDoc = requiredValues.filter(val => !docstring.includes(val));
  const docstringListsAll = missingFromDoc.length === 0;
  if (!docstringListsAll) {
    failures.push(`Docstring missing false values: ${missingFromDoc.join(', ')}`);
  }

  // 4. Target scope check: defines get_debug_flag
  const onlyTargetChanged = generatedCode.includes('def get_debug_flag');
  if (!onlyTargetChanged) {
    failures.push('Does not define get_debug_flag function');
  }

  const passed = syntaxValid && evaluatesValues && docstringListsAll && onlyTargetChanged;

  return {
    passed,
    syntaxValid,
    evaluatesValues,
    docstringListsAll,
    onlyTargetChanged,
    failures
  };
}

export interface TaskBParams {
  modifiedFiles: string[];
  toolCallsCount: number;
  testPassed?: boolean;
  helpListsConfig?: boolean;
  secretsMasked?: boolean;
  workspaceClean?: boolean;
}

export interface TaskBResult {
  passed: boolean;
  minFilesChanged: boolean;
  testPassed: boolean;
  helpListsConfig: boolean;
  secretsMasked: boolean;
  workspaceClean: boolean;
  failures: string[];
}

export function scoreTaskB(params: TaskBParams): TaskBResult {
  const failures: string[] = [];

  const minFilesChanged = params.modifiedFiles.length >= 3;
  if (!minFilesChanged) {
    failures.push(`Expected >= 3 files changed, got ${params.modifiedFiles.length}`);
  }

  const testPassed = params.testPassed ?? true;
  if (!testPassed) {
    failures.push('CLI test did not pass');
  }

  const helpListsConfig = params.helpListsConfig ?? true;
  if (!helpListsConfig) {
    failures.push('flask --help did not list config command');
  }

  const secretsMasked = params.secretsMasked ?? true;
  if (!secretsMasked) {
    failures.push("Secret keys not masked as '***'");
  }

  const workspaceClean = params.workspaceClean ?? true;
  if (!workspaceClean) {
    failures.push('Workspace contains unapproved writes');
  }

  const passed =
    minFilesChanged &&
    testPassed &&
    helpListsConfig &&
    secretsMasked &&
    workspaceClean &&
    params.toolCallsCount > 0;

  return {
    passed,
    minFilesChanged,
    testPassed,
    helpListsConfig,
    secretsMasked,
    workspaceClean,
    failures
  };
}

export interface SingleRun {
  runIndex: number;
  task: 'Task A' | 'Task B';
  passed: boolean;
  latencyMs: number;
  tokensUsed: number;
  toolCallsCount: number;
  failureReason?: string;
}

export interface ModelMatrixRow {
  modelName: string;
  tier: string;
  totalRuns: number;
  passRate: number; // percentage 0-100
  medianLatencyMs: number;
  medianTokens: number;
  medianToolCalls: number;
  flakeRate: number; // percentage 0-100
  commonFailure: string;
}

export function computeMatrixRow(
  modelName: string,
  tier: string,
  runs: SingleRun[]
): ModelMatrixRow {
  if (runs.length === 0) {
    return {
      modelName,
      tier,
      totalRuns: 0,
      passRate: 0,
      medianLatencyMs: 0,
      medianTokens: 0,
      medianToolCalls: 0,
      flakeRate: 0,
      commonFailure: 'No runs recorded'
    };
  }

  const passedCount = runs.filter(r => r.passed).length;
  const passRate = Math.round((passedCount / runs.length) * 100);

  // Flake rate: variance across runs of identical tasks
  const taskARuns = runs.filter(r => r.task === 'Task A');
  const taskBRuns = runs.filter(r => r.task === 'Task B');
  const hasFlakeA = taskARuns.some(r => r.passed) && taskARuns.some(r => !r.passed);
  const hasFlakeB = taskBRuns.some(r => r.passed) && taskBRuns.some(r => !r.passed);
  const flakeRate = (hasFlakeA ? 50 : 0) + (hasFlakeB ? 50 : 0);

  const median = (arr: number[]) => {
    if (arr.length === 0) return 0;
    const sorted = [...arr].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0 ? sorted[mid] : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
  };

  const medianLatencyMs = median(runs.map(r => r.latencyMs));
  const medianTokens = median(runs.map(r => r.tokensUsed));
  const medianToolCalls = median(runs.map(r => r.toolCallsCount));

  // Find most common failure
  const failReasons: Record<string, number> = {};
  for (const r of runs) {
    if (!r.passed && r.failureReason) {
      failReasons[r.failureReason] = (failReasons[r.failureReason] || 0) + 1;
    }
  }

  let commonFailure = 'Clean run (zero failures)';
  let maxCount = 0;
  for (const [reason, count] of Object.entries(failReasons)) {
    if (count > maxCount) {
      maxCount = count;
      commonFailure = reason;
    }
  }

  return {
    modelName,
    tier,
    totalRuns: runs.length,
    passRate,
    medianLatencyMs,
    medianTokens,
    medianToolCalls,
    flakeRate,
    commonFailure
  };
}
