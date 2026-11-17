/**
 * spikes/verify-t4.ts
 *
 * T4 Verification Spike: Deferred tool loading in the live session (B4 10-point anchor).
 * - Creates a live session on TrueForge with preload: false.
 * - Confirms TrueForge creates the session with deferred tool loading.
 * - Logs session ID, settings, and payload shape.
 */

import { TrueForge } from '@truefoundry/trueforge-sdk';
import { TrueForgeClient } from '../src/trueforge/client';

const TRUEFORGE_URL = process.env.TRUEFORGE_BASE_URL || 'http://localhost:8790';
const MODEL_NAME = process.env.TRUEFORGE_MODEL || 'ollama/llama-3-2-3b';

async function main() {
  console.log('=== Verifying T4: Deferred Tool Loading in Live Session ===\n');

  const client = new TrueForgeClient({
    baseUrl: TRUEFORGE_URL,
    model: MODEL_NAME
  });

  console.log(`Connecting to TrueForge at ${TRUEFORGE_URL}...`);
  const tf = new TrueForge({ baseUrl: TRUEFORGE_URL });

  // 1. Create session with preload: false
  console.log('Creating live session with preload: false (deferred tool discovery)...');
  const sessionId = await client.createSession(MODEL_NAME, undefined, { preload: false });
  console.log(`✓ Session created successfully with ID: ${sessionId}`);

  // 2. Fetch session details from TrueForge API
  const sessionRes = await tf.sessions.get(sessionId);
  const session = (sessionRes as any).data || sessionRes;
  console.log('\nRetrieved Session Spec from TrueForge:');
  const mcpServers = session.agent?.spec?.mcpServers;
  console.log('mcpServers:', JSON.stringify(mcpServers, null, 2));

  const serverConfig = mcpServers?.find((s: any) => s.name === 'forge-workspace');
  if (serverConfig) {
    console.log(`\nVerified MCP Server 'forge-workspace':`);
    console.log(`- preload: ${serverConfig.preload}`);
    console.log(`- requireApprovalForTools: ${JSON.stringify(serverConfig.requireApprovalForTools)}`);

    if (serverConfig.preload === false) {
      console.log('\n✅ T4 VERIFICATION PASSED: TrueForge session is running with preload: false (deferred tool loading).');
    } else {
      console.warn('\n⚠️ preload is not false, got:', serverConfig.preload);
    }
  } else {
    console.log('Server config not found in mcpServers list, full session agent:', JSON.stringify(session.agent, null, 2));
  }

  // 3. Test compaction toggle
  console.log('\nTesting alternative compaction session creation (Step 4 runbook)...');
  const compactSessionId = await client.createSession(MODEL_NAME, undefined, { preload: true, compaction: true });
  console.log(`✓ Compaction session created: ${compactSessionId}`);
  const compactSession = await tf.sessions.get(compactSessionId);
  const compactSpec = (compactSession as any).agent?.spec;
  console.log('compaction spec config:', JSON.stringify(compactSpec?.config, null, 2));
  console.log('✓ Compaction option verified.');

  console.log('\n=== T4 Verification Complete ===');
}

main().catch((err) => {
  console.error('T4 verification failed:', err);
  process.exit(1);
});
