import * as esbuild from 'esbuild';
import * as fs from 'fs';
import * as path from 'path';

const watch = process.argv.includes('--watch');

async function main() {
  // Ensure dist directory exists
  if (!fs.existsSync('dist')) {
    fs.mkdirSync('dist', { recursive: true });
  }

  // Copy webview styles.css to dist
  const stylesSrc = path.join('src', 'ui', 'webview', 'styles.css');
  const stylesDest = path.join('dist', 'styles.css');
  if (fs.existsSync(stylesSrc)) {
    fs.copyFileSync(stylesSrc, stylesDest);
  }

  // 1. Extension bundle (Node.js CJS)
  const extCtx = await esbuild.context({
    entryPoints: ['src/extension.ts'],
    bundle: true,
    format: 'cjs',
    minify: false,
    sourcemap: true,
    sourcesContent: false,
    platform: 'node',
    outfile: 'dist/extension.js',
    external: ['vscode'],
    logLevel: 'silent',
  });

  // 2. Webview bundle (Browser IIFE)
  const webviewCtx = await esbuild.context({
    entryPoints: ['src/ui/webview/main.ts'],
    bundle: true,
    format: 'iife',
    minify: false,
    sourcemap: true,
    sourcesContent: false,
    platform: 'browser',
    outfile: 'dist/webview.js',
    logLevel: 'silent',
  });

  if (watch) {
    await Promise.all([extCtx.watch(), webviewCtx.watch()]);
    console.log('watching...');
  } else {
    await Promise.all([extCtx.rebuild(), webviewCtx.rebuild()]);
    await Promise.all([extCtx.dispose(), webviewCtx.dispose()]);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
