import { validateFile, ValidationResult } from '../review/validate';

export interface PostAcceptResult {
  filePath: string;
  syntaxValid: boolean;
  errors: string[];
}

/**
 * Runs post-accept verification on a modified file.
 */
export async function runPostAcceptCheck(filePath: string, workspaceRoot?: string): Promise<PostAcceptResult> {
  const result: ValidationResult = await validateFile(filePath, workspaceRoot);
  return {
    filePath,
    syntaxValid: result.valid,
    errors: result.errors
  };
}
