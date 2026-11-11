import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/unit/**/*.test.ts', 'test/mcp/**/*.test.ts']
  },
  resolve: {
    alias: {
      vscode: path.resolve(__dirname, 'test/helpers/vscode-mock.ts')
    }
  }
});
