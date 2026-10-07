import type { OpenAIResponseShape } from './openAICompatible';

export class IncompleteCompletionStreamError extends Error {
  constructor() { super('LLM completion stream incomplete; server outcome is unknown.'); this.name = 'IncompleteCompletionStreamError'; }
}

/** Assemble SSE only at the provider boundary. No partial plan or reasoning
 * reaches authoring, persistence or adoption as business text. */
export function readCompletionStream(body: string): OpenAIResponseShape {
  const events = body.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n\n')
    .map(event => event.split('\n').filter(line => line.startsWith('data:'))
      .map(line => line.slice(5).replace(/^ /, '')).join('\n')).filter(Boolean);
  // A clean EOF alone is insufficient: intermediaries can truncate a 200 body.
  if (!events.includes('[DONE]')) throw new IncompleteCompletionStreamError();
  let done = false, sawChoice = false, id: string | undefined;
  let content = '', reasoning = '', finishReason: string | null = null;
  let usage: OpenAIResponseShape['usage'];
  for (const event of events) {
    if (done) throw new Error('Unexpected completion data after DONE.');
    if (event === '[DONE]') { done = true; continue; }
    const frame = JSON.parse(event) as { id?: string; error?: unknown; usage?: OpenAIResponseShape['usage'];
      choices?: Array<{ index?: number; delta?: { content?: string | null; reasoning_content?: string | null }; finish_reason?: string | null }> };
    if (!frame || typeof frame !== 'object' || frame.error) throw new Error('Invalid completion stream frame.');
    if (frame.id) {
      if (id && id !== frame.id) throw new Error('Completion stream request ID changed.');
      id = frame.id;
    }
    if (frame.usage) usage = frame.usage;
    const choice = frame.choices?.find(choice => choice.index === 0 || choice.index === undefined);
    if (!choice) continue; // A final usage-only frame has no choice.
    sawChoice = true;
    if (finishReason !== null) throw new Error('Completion stream choice continued after termination.');
    const delta = choice.delta;
    for (const text of [delta?.content, delta?.reasoning_content]) {
      if (text !== null && text !== undefined && typeof text !== 'string') throw new Error('Invalid completion stream text.');
    }
    content += delta?.content ?? '';
    reasoning += delta?.reasoning_content ?? '';
    if (choice.finish_reason) finishReason = choice.finish_reason;
  }
  if (!sawChoice || !finishReason) throw new IncompleteCompletionStreamError();
  return { id, choices: [{ finish_reason: finishReason, message: { content, reasoning_content: reasoning } }], usage };
}
