#!/usr/bin/env tsx
/**
 * Input Required Example
 *
 * Demonstrates the tool-input-required interrupt mechanism in two modes:
 *
 *   1. Tool-initiated  – a local tool calls inputRequired() when it needs a
 *      credential or confirmation.  The loop pauses with status
 *      'waiting-input'; this CLI collects the value; then the loop resumes
 *      with the value available via ExecutionContext.resolvedInputs.
 *
 *   2. LLM-initiated   – requestInputPlugin() advertises `request_input` to
 *      the model.  When the LLM calls it the call is intercepted before
 *      execution and surfaced as a tool-input-required event (same pause /
 *      resume cycle).  On resume a synthetic tool-complete is injected into
 *      message history so the LLM sees the answer on the next iteration.
 *
 * Run:
 *   pnpm tsx src/input-required.ts
 *
 * Environment:
 *   LITELLM_URL      LiteLLM proxy URL       (default: http://localhost:4000)
 *   LITELLM_API_KEY  LiteLLM API key         (optional)
 *   LITELLM_MODEL    Model name              (default: amazon.nova-lite-v1:0)
 *
 * Try asking:
 *   "Search the web for TypeScript best practices"
 *     → api_search asks for an API key before proceeding
 *
 *   "Send a message to #dev-team saying the build is green"
 *     → send_message asks for confirmation before sending
 *
 *   "What is the capital of France?"
 *     → LLM answers directly (no interrupt)
 *
 *   "Help me plan something" (deliberately vague)
 *     → LLM may call request_input to ask for clarification
 */

import * as readline from 'node:readline';
import {
  Agent,
  InMemoryMessageStore,
  inputRequired,
  LiteLLMProvider,
  literalPrompt,
  localTools,
  type PendingToolInput,
  requestInputPlugin,
  tool,
} from '@looopy-ai/core';
import * as dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

// ─── Tool definitions ──────────────────────────────────────────────────────

/**
 * api_search – searches an "external API" (simulated).
 *
 * First call  → handler detects no resolved value → returns inputRequired
 *               asking the user for an API key.
 * Resume call → resolvedInputs.get(toolCallId) contains the key → proceeds.
 */
const apiSearchTool = tool({
  id: 'api_search',
  description:
    'Search an external API for information on a topic. Requires an API key on first use.',
  schema: z.object({
    query: z.string().describe('Search query'),
  }),
  handler: async ({ query }, ctx) => {
    const apiKey = ctx.resolvedInputs?.get(ctx.toolCallId ?? '');
    if (!apiKey) {
      return inputRequired({
        inputType: 'data',
        prompt: 'api_search requires an API key. Enter your key to continue (not stored):',
      });
    }

    // Simulated API response — replace with a real fetch() in production.
    return {
      success: true,
      result: {
        query,
        key_preview: `${String(apiKey).slice(0, 4)}…`,
        results: [
          `[1] Simulated result for "${query}" — found via external API`,
          `[2] Another simulated result for "${query}"`,
        ],
      },
    };
  },
});

/**
 * send_message – sends a Slack-style message (simulated).
 *
 * First call  → always returns inputRequired (confirmation) with a preview.
 * Resume call → if the resolved value is "yes"/"y" → sends; otherwise
 *               cancels and reports back.
 */
const sendMessageTool = tool({
  id: 'send_message',
  description: 'Send a message to a Slack channel (simulated). Always asks for confirmation first.',
  schema: z.object({
    channel: z.string().describe('Channel name, e.g. #general'),
    message: z.string().describe('Message text to send'),
  }),
  handler: async ({ channel, message }, ctx) => {
    const confirmed = ctx.resolvedInputs?.get(ctx.toolCallId ?? '');

    if (confirmed === undefined || confirmed === null) {
      const preview = message.length > 80 ? `${message.slice(0, 80)}…` : message;
      return inputRequired({
        inputType: 'confirmation',
        prompt: `Send to ${channel}: "${preview}"`,
        options: ['yes', 'no'],
      });
    }

    const answer = String(confirmed).trim().toLowerCase();
    if (answer === 'yes' || answer === 'y') {
      // Simulated send — replace with a real API call in production.
      return { success: true, result: `✅ Message sent to ${channel}` };
    }
    return { success: true, result: '❌ Send cancelled.' };
  },
});

// ─── Agent setup ───────────────────────────────────────────────────────────

const llmProvider = new LiteLLMProvider({
  baseUrl: process.env.LITELLM_URL ?? 'http://localhost:4000',
  model: process.env.LITELLM_MODEL ?? 'amazon.nova-lite-v1:0',
  apiKey: process.env.LITELLM_API_KEY,
  temperature: 0.7,
  maxTokens: 4096,
});

const systemPrompt = literalPrompt(`You are a helpful assistant with two tools:

- api_search: searches an external API. Use it when the user asks to search or look up
  information. NOTE: it will ask for an API key before the first search.

- send_message: sends a Slack message (simulated). Use it when asked to send a message or
  notification. It always asks for confirmation before sending.

You also have access to the request_input tool. Use it whenever the user's request is
ambiguous or is missing information you need to do a good job (location, time frame,
audience, etc.).`);

const agent = new Agent({
  agentId: 'input-required-demo',
  contextId: 'demo-session',
  llmProvider,
  messageStore: new InMemoryMessageStore(),
  plugins: [
    systemPrompt,
    localTools([apiSearchTool, sendMessageTool]),
    requestInputPlugin(), // lets the LLM call request_input for clarification
  ],
});

// ─── Interactive CLI ───────────────────────────────────────────────────────

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: '\n> ',
});

/** Promisified readline.question for collecting a single value. */
const question = (prompt: string): Promise<string> =>
  new Promise((resolve) => rl.question(prompt, resolve));

const LINE = '─'.repeat(56);

/** Human-readable format hint shown inline at the prompt cursor. */
const formatHint = (p: PendingToolInput): string => {
  if (p.inputType === 'confirmation') {
    const opts = p.options?.length ? (p.options as string[]).join('/') : 'yes/no';
    return `(${opts}) `;
  }
  if (p.inputType === 'selection' && p.options?.length) return '(enter number or value) ';
  return '';
};

/** Render one input-request box to the terminal. */
const printInputCard = (p: PendingToolInput, index: number, total: number): void => {
  const counter = total > 1 ? ` ${index + 1}/${total}` : '';
  const source = p.isLlmRequest ? '🤖  AI clarification' : `🔧  ${p.toolName}`;

  console.log(`\n  ┌─ Input required${counter} ${'─'.repeat(Math.max(0, 38 - counter.length))}┐`);
  console.log(`  │  From : ${source}`);

  // Show the original tool arguments as context (skip for LLM-originated requests)
  if (!p.isLlmRequest && Object.keys(p.toolArguments).length > 0) {
    const argStr = Object.entries(p.toolArguments)
      .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
      .join(', ');
    const display = argStr.length > 44 ? `${argStr.slice(0, 43)}…` : argStr;
    console.log(`  │  Args : ${display}`);
  }

  console.log(`  ├${LINE}┤`);
  // Word-wrap the prompt at ~52 chars so it stays inside the box
  const words = p.prompt.split(' ');
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    if (cur.length + w.length + 1 > 52) {
      lines.push(cur);
      cur = w;
    } else {
      cur = cur ? `${cur} ${w}` : w;
    }
  }
  if (cur) lines.push(cur);
  for (const l of lines) console.log(`  │  ${l}`);

  console.log(`  ├${LINE}┤`);

  // Format guidance tailored to the input type
  switch (p.inputType) {
    case 'confirmation': {
      const opts = p.options?.length ? (p.options as string[]) : ['yes', 'no'];
      console.log(`  │  Type   : confirmation`);
      console.log(`  │  Options: ${opts.join('  |  ')}`);
      break;
    }
    case 'selection':
      console.log(`  │  Type   : selection`);
      if (p.options?.length) {
        (p.options as string[]).forEach((o, i) => {
          console.log(`  │    ${i + 1}. ${o}`);
        });
      }
      break;
    case 'clarification':
      console.log(`  │  Type   : clarification  (free-text answer)`);
      break;
    case 'data': {
      console.log(`  │  Type   : data`);
      const props = (
        p.schema as
          | { properties?: Record<string, { type?: string; description?: string }> }
          | undefined
      )?.properties;
      if (props) {
        const desc = Object.entries(props)
          .map(
            ([k, v]) => `${k} (${v.type ?? 'string'})${v.description ? ` — ${v.description}` : ''}`,
          )
          .join(', ');
        const display = desc.length > 48 ? `${desc.slice(0, 47)}…` : desc;
        console.log(`  │  Schema : ${display}`);
      }
      break;
    }
  }

  console.log(`  └${LINE}┘`);
};

/**
 * Prompt the user for every pending input and return resolved { inputId, value } pairs.
 * Prints a structured card for each request so the user knows exactly what is
 * being asked for and in what format.
 */
const collectInputs = async (
  pending: readonly PendingToolInput[],
): Promise<Array<{ inputId: string; value: string }>> => {
  const inputs: Array<{ inputId: string; value: string }> = [];

  if (pending.length > 1) {
    console.log(`\n  📋  ${pending.length} inputs pending:`);
    pending.forEach((p, i) => {
      const source = p.isLlmRequest ? 'AI' : p.toolName;
      console.log(`       ${i + 1}. [${source}] ${p.prompt}`);
    });
  }

  for (let i = 0; i < pending.length; i++) {
    const p = pending[i];
    printInputCard(p, i, pending.length);
    const value = await question(`  › ${formatHint(p)}`);
    inputs.push({ inputId: p.inputId, value: value.trim() });
  }

  return inputs;
};

/**
 * Start a turn, print events, then recursively handle waiting-input until
 * the agent reaches 'idle'.
 */
const runTurn = async (
  userMessage: string | null,
  inputs?: Array<{ inputId: string; value: string }>,
): Promise<void> => {
  const events$ = await agent.startTurn(userMessage, inputs?.length ? { inputs } : undefined);

  await new Promise<void>((resolve, reject) => {
    events$.subscribe({
      next(event) {
        switch (event.kind) {
          case 'task-status':
            if (event.status === 'working') {
              process.stdout.write('\n⏳ ');
            } else if (event.status === 'waiting-input') {
              // Visual handled below; the agent loop completes after emitting this.
            } else if (event.status === 'failed') {
              console.error(`\n❌ ${event.message ?? 'Unknown error'}`);
            }
            break;

          case 'content-delta':
            process.stdout.write(event.delta);
            break;

          case 'content-complete':
            // Newline after streaming; task-complete carries the final summary.
            if (event.finishReason !== 'tool_calls') process.stdout.write('\n');
            break;

          case 'tool-start':
            console.log(`\n🔧 Calling ${event.toolName}…`);
            break;

          case 'tool-complete':
            if (event.success) {
              console.log(`   ✅ ${event.toolName} done`);
            } else {
              console.log(`   ❌ ${event.toolName} failed: ${event.error}`);
            }
            break;

          case 'tool-input-required':
            console.log(`\n⏸  ${event.toolName} needs: ${event.prompt}`);
            break;

          case 'task-complete':
            if (event.content) {
              console.log(`\n🤖 ${event.content}`);
            }
            break;
        }
      },
      error: reject,
      complete: resolve,
    });
  });

  // Recursively collect inputs and resume until the agent reaches idle.
  if (agent.state.status === 'waiting-input') {
    const pending = agent.state.pendingToolInputs ?? [];
    const resolved = await collectInputs(pending);
    console.log('');
    await runTurn(null, resolved);
  }
};

// ─── Main loop ─────────────────────────────────────────────────────────────

const main = async () => {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║  Input Required Demo   (type /quit or press Ctrl+C)      ║');
  console.log('╠══════════════════════════════════════════════════════════╣');
  console.log('║  Try:                                                    ║');
  console.log('║    "Search for TypeScript best practices"                ║');
  console.log('║      → api_search asks for an API key first              ║');
  console.log('║    "Send a message to #dev-team: build is green"         ║');
  console.log('║      → send_message asks for confirmation                ║');
  console.log('║    "Help me plan an event" (deliberately vague)          ║');
  console.log('║      → LLM may call request_input for clarification      ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log('');

  rl.prompt();

  rl.on('line', async (line) => {
    const input = line.trim();

    if (!input) {
      rl.prompt();
      return;
    }

    if (input === '/quit' || input === '/exit' || input === 'q') {
      await agent.shutdown();
      rl.close();
      process.exit(0);
    }

    console.log('');
    try {
      await runTurn(input);
    } catch (err) {
      console.error('\n❌ Error:', (err as Error).message);
    }
    rl.prompt();
  });

  rl.on('close', () => process.exit(0));
};

main().catch((err) => {
  console.error('💣 Fatal:', err);
  process.exit(1);
});
