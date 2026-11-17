/**
 * Cross-platform TrueForge runner locked to pinned version 0.184.3.
 * Supports Windows, macOS, and Linux.
 */
const { spawn } = require('child_process');

const PORT = process.env.PORT || '8790';
const MCP_PORT = process.env.MCP_PORT || '8765';
const VERSION = '0.184.3';

console.log(`=== Starting TrueForge v${VERSION} on port ${PORT} ===`);
console.log('Allowed local model hosts: localhost, 127.0.0.1');
console.log(`TrueForge: http://localhost:${PORT}`);
console.log(`MCP: http://127.0.0.1:${MCP_PORT}`);

const isWin = process.platform === 'win32';
const npxCmd = isWin ? 'npx.cmd' : 'npx';

const env = {
  ...process.env,
  NETWORK_POLICY_ENABLED: 'true',
  OUTBOUND_URL_ALLOWED_HOSTS: '["localhost","127.0.0.1"]'
};

const child = spawn(
  npxCmd,
  ['--yes', `@truefoundry/trueforge@${VERSION}`, '--port', PORT],
  {
    stdio: 'inherit',
    env,
    shell: isWin
  }
);

child.on('error', (err) => {
  console.error('Failed to spawn TrueForge:', err);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (signal) {
    console.log(`TrueForge terminated with signal ${signal}`);
  } else {
    console.log(`TrueForge exited with code ${code}`);
  }
  process.exit(code || 0);
});
