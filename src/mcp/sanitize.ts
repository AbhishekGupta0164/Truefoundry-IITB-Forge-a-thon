export const DEFAULT_TOOL_OUTPUT_CAP = 2048; // ~2 KB

export function sanitizeToolOutput(rawOutput: string, maxLength = DEFAULT_TOOL_OUTPUT_CAP): string {
  if (!rawOutput) {
    return '';
  }

  let text = rawOutput;
  if (text.length > maxLength) {
    text = text.slice(0, maxLength) + `\n... [Output truncated to ${maxLength} characters (~2 KB cap)]`;
  }

  // Wrap output in a clean structured container
  return `<!-- Untrusted Tool Output Begin -->\n${text}\n<!-- Untrusted Tool Output End -->`;
}
