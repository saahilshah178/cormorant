import { convertToModelMessages, streamText, type UIMessage } from "ai";
import { reasoningModel } from "@/lib/models";

// Allow streamed responses up to 30s (Vercel serverless default is shorter).
export const maxDuration = 30;

/**
 * Streaming chat endpoint (PLAN.md task 0.2).
 *
 * AI SDK v7 pattern: the client (`useChat`) sends UIMessages; convert them to
 * model messages, `streamText`, and return `toUIMessageStreamResponse()` so the
 * response streams token-by-token back into the UI message parts.
 */
export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();

  const result = streamText({
    model: reasoningModel,
    system:
      "You are Cormorant, an AI analyst for a venture-capital firm. Be concise, " +
      "concrete, and honest — including about risks. This endpoint is a Tier 0 " +
      "connectivity check; real thesis-scoring arrives in later tiers.",
    messages: await convertToModelMessages(messages),
  });

  return result.toUIMessageStreamResponse();
}
