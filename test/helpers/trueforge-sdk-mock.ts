/**
 * Mock @truefoundry/trueforge-sdk for Vitest test execution
 */

export class TrueForge {
  public sessions = {
    create: async (_params: any) => ({
      data: {
        id: `mock-session-${Date.now()}`
      }
    }),
    createTurnStream: async (_sessionId: string, _params: any) => {
      async function* mockGenerator() {
        yield { type: 'token', delta: { text: 'Mock response' } };
        yield { type: 'done', status: 'completed', total_tokens: 50 };
      }
      return mockGenerator();
    },
    cancel: async (_sessionId: string) => true,
    subscribeToTurn: async (_sessionId: string, _turnId: string) => {
      async function* mockGenerator() {
        yield { type: 'token', delta: { text: 'Subscribed turn response' } };
        yield { type: 'done', status: 'completed' };
      }
      return mockGenerator();
    }
  };

  constructor(_options?: any) {}
}

export default { TrueForge };
