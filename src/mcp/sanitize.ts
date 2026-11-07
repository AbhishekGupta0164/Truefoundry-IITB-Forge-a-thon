const MAX_OUTPUT_CHARS = 20_000;

export function sanitizeToolOutput(rawOutput: string, maxLength = MAX_OUTPUT_CHARS): string {
  if (!rawOutput) {
    return '';
  }

  let text = rawOutput;
  if (text.length > maxLength) {
    text = text.slice(0, maxLength) + `\n... [Output truncated to ${maxLength} characters]`;
  }

  // Wrap output in a clean structured container
  return `<!-- Untrusted Tool Output Begin -->\n${text}\n<!-- Untrusted Tool Output End -->`;
}
