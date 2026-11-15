import { TrueForge } from "@truefoundry/trueforge-sdk";
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";

const BASE_URL = process.env.TRUEFORGE_BASE_URL ?? "http://localhost:8790";

// Use the provider/model identifier configured in TrueForge Settings.
// For your Ollama setup, this is expected to be ollama/llama3.2:3b.
const MODEL_NAME = process.env.TRUEFORGE_MODEL ?? "ollama/llama3.2:3b";

const client = new TrueForge({
  baseUrl: BASE_URL,
  timeoutInSeconds: 600,
});

async function main() {
  mkdirSync("docs/spikes", { recursive: true });

  const logPath = "docs/spikes/s1-events.jsonl";
  writeFileSync(logPath, "");

  console.log("Creating inline-agent session...");
  console.log("Server:", BASE_URL);
  console.log("Model:", MODEL_NAME);

  const { data: session } = await client.sessions.create({
    agent: {
      spec: {
        model: { name: MODEL_NAME },
        instructions: "You are a text-only assistant. Never call tools or request user input. Do not ask questions. Always respond directly in plain text with a short answer.",
      },
    },
  });

  console.log("Session created:", session.id);
  console.log("\nStarting streamed turn...\n");

  const stream = await client.sessions.createTurnStream(session.id, {
    input: [
      {
        type: "user.message",
        content: "Reply with exactly this text: Hello from TrueForge!",
      },
    ],
  });

  let eventCount = 0;

  for await (const { data: event, id } of stream.withMetadata()) {
    eventCount++;

    // Preserve the raw event and its stream sequence ID.
    appendFileSync(
      logPath,
      JSON.stringify({ sequenceId: id, event }) + "\n",
    );

    console.log(`[${id ?? eventCount}] ${event.type}`);

    if (event.type === "model.message.delta") {
      const delta = event as unknown as { delta?: { text?: string } };
      if (delta.delta?.text) {
        process.stdout.write(delta.delta.text);
      }
    }
  }

  console.log("\n\nStream finished.");
  console.log("Session ID:", session.id);
  console.log("Events captured:", eventCount);
  console.log("Raw event log:", logPath);

  if (eventCount === 0) {
    throw new Error("No streaming events received.");
  }
}

main().catch((error) => {
  console.error("\nS1 STREAM TEST FAILED:");
  console.error(error);
  process.exitCode = 1;
});
