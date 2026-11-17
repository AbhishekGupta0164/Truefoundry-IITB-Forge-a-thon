import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    fileParallelism: false,
    include: ['test/unit/**/*.test.ts', 'test/mcp/**/*.test.ts', 'test/e2e/**/*.test.ts']
  },
  resolve: {
    alias: {
      vscode: path.resolve(__dirname, 'test/helpers/vscode-mock.ts')
    }
  }
});
