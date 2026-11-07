import { ForgeEvent } from '../shared/events';

export interface RawStreamChunk {
  event?: string;
  data: string;
}

export async function* parseSSEStream(
  reader: ReadableStreamDefaultReader<Uint8Array>
): AsyncGenerator<ForgeEvent, void, unknown> {
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('data:')) {
          const jsonStr = trimmed.slice(5).trim();
          if (jsonStr === '[DONE]') {
            yield {
              type: 'done',
              status: 'completed',
              budget: {
                maxTokens: 100000,
                usedTokens: 0,
                maxCostUsd: 2.0,
                usedCostUsd: 0,
                maxIterations: 30,
                currentIteration: 1
              },
              timestamp: Date.now()
            };
            return;
          }
          try {
            const parsed = JSON.parse(jsonStr) as ForgeEvent;
            yield parsed;
          } catch {
            // raw text token fallback
            yield {
              type: 'token',
              text: jsonStr,
              timestamp: Date.now()
            };
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
