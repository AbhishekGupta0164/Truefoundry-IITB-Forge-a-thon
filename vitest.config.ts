import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['test/unit/**/*.test.ts', 'test/mcp/**/*.test.ts', 'test/e2e/**/*.test.ts']
  },
  resolve: {
    alias: {
      vscode: path.resolve(__dirname, 'test/helpers/vscode-mock.ts'),
      '@truefoundry/trueforge-sdk': path.resolve(__dirname, 'test/helpers/trueforge-sdk-mock.ts')
    }
  }
});
