/**
 * Tests for the tool-input-required interrupt mechanism.
 *
 * Covers:
 * 1. A tool emitting tool-input-required stops the loop and surfaces task-status: waiting-input
 * 2. Resuming a tool call with resolvedInputs completes normally
 * 3. Parallel tools: one completes, one interrupts — partial resume works
 * 4. Cancel path: new userMessage while waiting-input injects synthetic tool-complete errors
 * 5. requestInputPlugin lists the request_input tool and emits tool-input-required defensively
 * 6. inputRequired() helper constructs correct result shape
 */

import pino from 'pino';
import { lastValueFrom, toArray } from 'rxjs';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { Agent } from '../src/core/agent';
import { InMemoryMessageStore } from '../src/stores/messages/memory-message-store';
import { inputRequired, localTools, tool } from '../src/tools/local-tools';
import { REQUEST_INPUT_TOOL_NAME, requestInputPlugin } from '../src/tools/request-input-tool';
import { toolInputRequiredEvent } from '../src/tools/tool-result-events';
import type { PendingToolInput } from '../src/types/agent';
import type {
  ContentCompleteEvent,
  TaskStatusEvent,
  ToolCompleteEvent,
  ToolInputRequiredEvent,
} from '../src/types/event';
import type { LLMProvider } from '../src/types/llm';
import { mockIterationContext } from './utils';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

import { concat, of } from 'rxjs';

/** Build a minimal stub LLM provider that returns a fixed sequence of responses. */
function makeLLMProvider(
  responses: Array<() => import('rxjs').Observable<import('../src/types/event').AnyEvent>>,
): LLMProvider {
  let callIndex = 0;
  return {
    call: () => {
      const respFn = responses[callIndex];
      callIndex = Math.min(callIndex + 1, responses.length - 1);
      return respFn();
    },
  } as unknown as LLMProvider;
}

/** Emit a simple content-complete (no tool calls). */
function llmTextResponse(text: string) {
  return () =>
    of({
      kind: 'content-complete' as const,
      content: text,
      finishReason: 'stop' as const,
      timestamp: new Date().toISOString(),
    } as import('../src/types/event').AnyEvent);
}

/** Emit a tool-call event followed by content-complete with finishReason: tool_calls.
 * This matches how the real LiteLLM provider works. */
function llmToolCallResponse(toolCallId: string, toolName: string, args: Record<string, unknown>) {
  const timestamp = new Date().toISOString();
  return () =>
    concat(
      of({
        kind: 'tool-call' as const,
        toolCallId,
        toolName,
        arguments: args,
        timestamp,
      } as import('../src/types/event').AnyEvent),
      of({
        kind: 'content-complete' as const,
        content: '',
        finishReason: 'tool_calls' as const,
        toolCalls: [
          {
            id: toolCallId,
            type: 'function' as const,
            function: { name: toolName, arguments: args },
          },
        ],
        timestamp,
      } as import('../src/types/event').AnyEvent),
    );
}

/** Emit multiple parallel tool-call events followed by content-complete with all calls. */
function llmParallelToolCallResponse(
  calls: Array<{ toolCallId: string; toolName: string; args: Record<string, unknown> }>,
) {
  const timestamp = new Date().toISOString();
  return () =>
    concat(
      ...calls.map(({ toolCallId, toolName, args }) =>
        of({
          kind: 'tool-call' as const,
          toolCallId,
          toolName,
          arguments: args,
          timestamp,
        } as import('../src/types/event').AnyEvent),
      ),
      of({
        kind: 'content-complete' as const,
        content: '',
        finishReason: 'tool_calls' as const,
        toolCalls: calls.map(({ toolCallId, toolName, args }) => ({
          id: toolCallId,
          type: 'function' as const,
          function: { name: toolName, arguments: args },
        })),
        timestamp,
      } as import('../src/types/event').AnyEvent),
    );
}

function makeAgent(
  llmProvider: LLMProvider,
  plugins: import('../src/types/core').Plugin<unknown>[],
) {
  return new Agent<unknown>({
    agentId: 'test-agent',
    contextId: `ctx-${Math.random().toString(36).slice(2)}`,
    llmProvider,
    messageStore: new InMemoryMessageStore(),
    plugins,
    logger: pino({ level: 'silent' }),
  });
}

// ---------------------------------------------------------------------------
// 1. tool emitting tool-input-required stops the loop
// ---------------------------------------------------------------------------

describe('tool-input-required: loop stop', () => {
  it('stops the loop and emits task-status: waiting-input when a tool requests input', async () => {
    const credentialTool = tool({
      id: 'use_api',
      description: 'Calls an external API',
      schema: z.object({ endpoint: z.string() }),
      handler: async (_params, ctx) => {
        const apiKey = ctx.resolvedInputs?.get(ctx.toolCallId ?? '');
        if (!apiKey) {
          return inputRequired({ inputType: 'data', prompt: 'Please provide your API key' });
        }
        return { success: true, result: `called ${_params.endpoint} with key ${apiKey}` };
      },
    });

    const provider = makeLLMProvider([
      llmToolCallResponse('call-1', 'use_api', { endpoint: 'https://example.com' }),
    ]);

    const agent = makeAgent(provider, [localTools([credentialTool])]);
    const obs = await agent.startTurn('Call the API');
    const events = await lastValueFrom(obs.pipe(toArray()));

    const kinds = events.map((e) => e.kind);
    expect(kinds).toContain('tool-input-required');
    expect(kinds).toContain('task-status');

    const waitingStatus = events.find(
      (e) => e.kind === 'task-status' && (e as TaskStatusEvent).status === 'waiting-input',
    );
    expect(waitingStatus).toBeDefined();

    // Agent state must be waiting-input
    expect(agent.state.status).toBe('waiting-input');
    expect(agent.state.pendingToolInputs).toHaveLength(1);
    expect(agent.state.pendingToolInputs?.[0].toolName).toBe('use_api');
  });

  it('exposes the inputId and prompt on the pending tool input', async () => {
    const credentialTool = tool({
      id: 'use_api',
      description: 'API tool',
      schema: z.object({}),
      handler: async (_params, ctx) => {
        if (!ctx.resolvedInputs?.get(ctx.toolCallId ?? '')) {
          return inputRequired({ inputType: 'data', prompt: 'Enter your API key' });
        }
        return { success: true, result: 'ok' };
      },
    });

    const agent = makeAgent(makeLLMProvider([llmToolCallResponse('call-1', 'use_api', {})]), [
      localTools([credentialTool]),
    ]);

    await lastValueFrom((await agent.startTurn('go')).pipe(toArray()));

    const pending = (agent.state.pendingToolInputs as PendingToolInput[])[0];
    expect(pending.inputType).toBe('data');
    expect(pending.prompt).toBe('Enter your API key');
    expect(pending.inputId).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// 2. Resume with resolvedInputs completes the tool and restarts the loop
// ---------------------------------------------------------------------------

describe('tool-input-required: resume', () => {
  it('re-calls the tool with the resolved value and continues the loop', async () => {
    let callCount = 0;
    const credentialTool = tool({
      id: 'use_api',
      description: 'API tool',
      schema: z.object({ endpoint: z.string() }),
      handler: async (params, ctx) => {
        callCount++;
        const apiKey = ctx.resolvedInputs?.get(ctx.toolCallId ?? '');
        if (!apiKey) {
          return inputRequired({ inputType: 'data', prompt: 'Enter API key' });
        }
        return { success: true, result: `${params.endpoint}:${apiKey}` };
      },
    });

    const provider = makeLLMProvider([
      // First call: LLM requests tool
      llmToolCallResponse('call-1', 'use_api', { endpoint: 'https://api.example.com' }),
      // Second call (after tool result injected): LLM gives final answer
      llmTextResponse('Done!'),
    ]);

    const agent = makeAgent(provider, [localTools([credentialTool])]);

    // First turn — tool fires, loop stops
    await lastValueFrom((await agent.startTurn('Call the API')).pipe(toArray()));
    expect(agent.state.status).toBe('waiting-input');

    const pendingInputId = (agent.state.pendingToolInputs as PendingToolInput[])[0].inputId;

    // Resume turn — provide the API key
    const resumeEvents = await lastValueFrom(
      (
        await agent.startTurn(null, {
          inputs: [{ inputId: pendingInputId, value: 'secret-key-123' }],
        })
      ).pipe(toArray()),
    );

    expect(agent.state.status).toBe('idle');
    expect(agent.state.pendingToolInputs).toBeUndefined();
    expect(callCount).toBe(2); // tool was called twice (first request + resume)

    const toolComplete = resumeEvents.find(
      (e) => e.kind === 'tool-complete' && (e as ToolCompleteEvent).toolName === 'use_api',
    );
    expect(toolComplete).toBeDefined();
    expect((toolComplete as ToolCompleteEvent).success).toBe(true);
    expect((toolComplete as ToolCompleteEvent).result).toBe(
      'https://api.example.com:secret-key-123',
    );
  });

  it('stays in waiting-input when the resumed tool still needs more input (chaining)', async () => {
    // Tool performs a two-round input flow:
    // Round 1: no resolved value yet → asks for input
    // Round 2: resolved value is the sentinel 'need-more' → asks for more input
    // Round 3 / final: resolved value is anything else → completes
    const chainedTool = tool({
      id: 'chained',
      description: 'Needs two rounds of input',
      schema: z.object({}),
      handler: async (_params, ctx) => {
        const value = ctx.resolvedInputs?.get(ctx.toolCallId ?? '');
        if (!value) {
          return inputRequired({ inputType: 'data', prompt: 'Round 1' });
        }
        if (value === 'need-more') {
          return inputRequired({ inputType: 'data', prompt: 'Round 2' });
        }
        return { success: true, result: `done with ${value}` };
      },
    });

    const provider = makeLLMProvider([
      llmToolCallResponse('call-chain', 'chained', {}),
      llmTextResponse('All done'),
    ]);

    const agent = makeAgent(provider, [localTools([chainedTool])]);

    await lastValueFrom((await agent.startTurn('start')).pipe(toArray()));
    expect(agent.state.status).toBe('waiting-input');
    const firstPendingId = (agent.state.pendingToolInputs as PendingToolInput[])[0].inputId;

    // First resume — provide sentinel to trigger second round
    await lastValueFrom(
      (
        await agent.startTurn(null, { inputs: [{ inputId: firstPendingId, value: 'need-more' }] })
      ).pipe(toArray()),
    );
    expect(agent.state.status).toBe('waiting-input');
    const secondPendingId = (agent.state.pendingToolInputs as PendingToolInput[])[0].inputId;
    expect(secondPendingId).not.toBe(firstPendingId);

    // Second resume — final value, tool completes
    const finalEvents = await lastValueFrom(
      (
        await agent.startTurn(null, {
          inputs: [{ inputId: secondPendingId, value: 'final-value' }],
        })
      ).pipe(toArray()),
    );
    expect(agent.state.status).toBe('idle');

    const toolComplete = finalEvents.find(
      (e) => e.kind === 'tool-complete' && (e as ToolCompleteEvent).toolName === 'chained',
    );
    expect(toolComplete).toBeDefined();
    expect((toolComplete as ToolCompleteEvent).result).toBe('done with final-value');
  });
});

// ---------------------------------------------------------------------------
// 3. Parallel tools — one completes, one interrupts
// ---------------------------------------------------------------------------

describe('tool-input-required: parallel tools partial interrupt', () => {
  it('completes the normal tool immediately; waits only for the interrupting tool', async () => {
    const normalTool = tool({
      id: 'normal',
      description: 'Always completes',
      schema: z.object({}),
      handler: async () => ({ success: true, result: 'normal-result' }),
    });

    const interruptingTool = tool({
      id: 'needs_key',
      description: 'Needs a key',
      schema: z.object({}),
      handler: async (_p, ctx) => {
        if (!ctx.resolvedInputs?.get(ctx.toolCallId ?? '')) {
          return inputRequired({ inputType: 'data', prompt: 'Provide key' });
        }
        return { success: true, result: 'used-key' };
      },
    });

    const provider = makeLLMProvider([
      // LLM calls both tools in parallel
      llmParallelToolCallResponse([
        { toolCallId: 'call-normal', toolName: 'normal', args: {} },
        { toolCallId: 'call-key', toolName: 'needs_key', args: {} },
      ]),
      llmTextResponse('Both done'),
    ]);

    const agent = makeAgent(provider, [localTools([normalTool, interruptingTool])]);

    const firstTurnEvents = await lastValueFrom((await agent.startTurn('Do both')).pipe(toArray()));

    // normal tool should be complete
    const normalComplete = firstTurnEvents.find(
      (e) => e.kind === 'tool-complete' && (e as ToolCompleteEvent).toolName === 'normal',
    );
    expect(normalComplete).toBeDefined();
    expect((normalComplete as ToolCompleteEvent).success).toBe(true);

    // needs_key tool should be interrupted
    const interrupted = firstTurnEvents.find(
      (e) =>
        e.kind === 'tool-input-required' && (e as ToolInputRequiredEvent).toolName === 'needs_key',
    );
    expect(interrupted).toBeDefined();

    expect(agent.state.status).toBe('waiting-input');
    expect(agent.state.pendingToolInputs).toHaveLength(1);
    expect(agent.state.pendingToolInputs?.[0].toolName).toBe('needs_key');

    // Resume only the interrupted tool
    const pendingId = (agent.state.pendingToolInputs as PendingToolInput[])[0].inputId;
    const resumeEvents = await lastValueFrom(
      (await agent.startTurn(null, { inputs: [{ inputId: pendingId, value: 'my-key' }] })).pipe(
        toArray(),
      ),
    );

    expect(agent.state.status).toBe('idle');

    const keyComplete = resumeEvents.find(
      (e) => e.kind === 'tool-complete' && (e as ToolCompleteEvent).toolName === 'needs_key',
    );
    expect(keyComplete).toBeDefined();
    expect((keyComplete as ToolCompleteEvent).result).toBe('used-key');
  });
});

// ---------------------------------------------------------------------------
// 4. Cancel path — new userMessage while waiting-input
// ---------------------------------------------------------------------------

describe('tool-input-required: cancel path', () => {
  it('injects synthetic tool-complete errors and clears pending state on cancel', async () => {
    const pendingTool = tool({
      id: 'pending',
      description: 'Needs input',
      schema: z.object({}),
      handler: async (_p, ctx) => {
        if (!ctx.resolvedInputs?.get(ctx.toolCallId ?? '')) {
          return inputRequired({ inputType: 'data', prompt: 'Need something' });
        }
        return { success: true, result: 'ok' };
      },
    });

    const provider = makeLLMProvider([
      llmToolCallResponse('call-pending', 'pending', {}),
      llmTextResponse('Ok, starting fresh'),
    ]);

    const agent = makeAgent(provider, [localTools([pendingTool])]);

    await lastValueFrom((await agent.startTurn('start')).pipe(toArray()));
    expect(agent.state.status).toBe('waiting-input');

    // Cancel by sending a new user message
    const cancelEvents = await lastValueFrom(
      (await agent.startTurn('Forget it, do something else')).pipe(toArray()),
    );

    // A synthetic tool-complete with success:false should be in the stream
    const cancellationEvent = cancelEvents.find(
      (e) =>
        e.kind === 'tool-complete' &&
        (e as ToolCompleteEvent).toolName === 'pending' &&
        !(e as ToolCompleteEvent).success,
    );
    expect(cancellationEvent).toBeDefined();
    expect((cancellationEvent as ToolCompleteEvent).error).toContain('Cancelled');

    // Agent should be idle with no pending inputs
    expect(agent.state.status).toBe('idle');
    expect(agent.state.pendingToolInputs).toBeUndefined();

    // The new turn should have continued to a final response
    const finalContent = cancelEvents.find((e) => e.kind === 'content-complete');
    expect(finalContent).toBeDefined();
    expect((finalContent as ContentCompleteEvent).content).toBe('Ok, starting fresh');
  });

  it('emits task-status: failed when called with no inputs and no userMessage while waiting-input', async () => {
    const pendingTool = tool({
      id: 'pending',
      description: 'Needs input',
      schema: z.object({}),
      handler: async (_p, ctx) => {
        if (!ctx.resolvedInputs?.get(ctx.toolCallId ?? '')) {
          return inputRequired({ prompt: 'Need something' });
        }
        return { success: true, result: 'ok' };
      },
    });

    const agent = makeAgent(makeLLMProvider([llmToolCallResponse('call-1', 'pending', {})]), [
      localTools([pendingTool]),
    ]);

    await lastValueFrom((await agent.startTurn('start')).pipe(toArray()));
    expect(agent.state.status).toBe('waiting-input');

    // Call startTurn with no useful arguments — agent converts error to failed event
    const events = await lastValueFrom((await agent.startTurn(null)).pipe(toArray()));

    const failEvent = events.find(
      (e) => e.kind === 'task-status' && (e as TaskStatusEvent).status === 'failed',
    );
    expect(failEvent).toBeDefined();
    expect((failEvent as TaskStatusEvent).message).toContain('waiting for input');
  });
});

// ---------------------------------------------------------------------------
// 5. requestInputPlugin
// ---------------------------------------------------------------------------

describe('requestInputPlugin', () => {
  it('lists request_input as an available tool', async () => {
    const plugin = requestInputPlugin();
    const tools = await plugin.listTools(mockIterationContext());
    expect(tools).toHaveLength(1);
    expect(tools[0].id).toBe(REQUEST_INPUT_TOOL_NAME);
    expect(tools[0].parameters.required).toContain('prompt');
  });

  it('getTool returns definition for request_input', async () => {
    const plugin = requestInputPlugin();
    const def = await plugin.getTool(REQUEST_INPUT_TOOL_NAME, mockIterationContext());
    expect(def).toBeDefined();
    expect(def?.id).toBe(REQUEST_INPUT_TOOL_NAME);
  });

  it('getTool returns undefined for unknown tools', async () => {
    const plugin = requestInputPlugin();
    const def = await plugin.getTool('other_tool', mockIterationContext());
    expect(def).toBeUndefined();
  });

  it('executeTool (defensive path) emits tool-input-required', async () => {
    const plugin = requestInputPlugin();
    const toolCall = {
      id: 'call-ri',
      type: 'function' as const,
      function: {
        name: REQUEST_INPUT_TOOL_NAME,
        arguments: { prompt: 'What is your name?', input_type: 'clarification' },
      },
    };

    const events = await lastValueFrom(
      plugin.executeTool(toolCall, mockIterationContext()).pipe(toArray()),
    );

    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('tool-input-required');
    expect((events[0] as ToolInputRequiredEvent).prompt).toBe('What is your name?');
    expect((events[0] as ToolInputRequiredEvent).inputType).toBe('clarification');
  });

  it('intercepts request_input in the agent loop and pauses with waiting-input', async () => {
    // LLM decides to call request_input
    const provider = makeLLMProvider([
      llmToolCallResponse('call-ri', REQUEST_INPUT_TOOL_NAME, {
        prompt: 'What city?',
        input_type: 'clarification',
      }),
      llmTextResponse('The weather in Paris is sunny'),
    ]);

    const agent = makeAgent(provider, [requestInputPlugin()]);

    await lastValueFrom((await agent.startTurn('What is the weather?')).pipe(toArray()));

    expect(agent.state.status).toBe('waiting-input');
    const pending = (agent.state.pendingToolInputs as PendingToolInput[])[0];
    expect(pending.isLlmRequest).toBe(true);
    expect(pending.prompt).toBe('What city?');

    // Resume with the city name
    const resumeEvents = await lastValueFrom(
      (
        await agent.startTurn(null, { inputs: [{ inputId: pending.inputId, value: 'Paris' }] })
      ).pipe(toArray()),
    );

    expect(agent.state.status).toBe('idle');

    // A synthetic tool-complete should have been emitted with the city
    const syntheticComplete = resumeEvents.find(
      (e) =>
        e.kind === 'tool-complete' && (e as ToolCompleteEvent).toolName === REQUEST_INPUT_TOOL_NAME,
    );
    expect(syntheticComplete).toBeDefined();
    expect((syntheticComplete as ToolCompleteEvent).result).toBe('Paris');

    // Final LLM response should also be in the stream
    const content = resumeEvents.find((e) => e.kind === 'content-complete');
    expect(content).toBeDefined();
    expect((content as ContentCompleteEvent).content).toBe('The weather in Paris is sunny');
  });
});

// ---------------------------------------------------------------------------
// 6. inputRequired() helper
// ---------------------------------------------------------------------------

describe('inputRequired()', () => {
  it('defaults inputType to data when omitted', () => {
    const result = inputRequired({ prompt: 'Give me a value' });
    expect(result.inputRequired.inputType).toBe('data');
    expect(result.inputRequired.prompt).toBe('Give me a value');
  });

  it('uses the provided inputType', () => {
    const result = inputRequired({ prompt: 'Confirm?', inputType: 'confirmation' });
    expect(result.inputRequired.inputType).toBe('confirmation');
  });

  it('passes through schema and options', () => {
    const schema = { type: 'object', properties: { key: { type: 'string' } } };
    const options = ['a', 'b', 'c'];
    const result = inputRequired({
      prompt: 'Pick one',
      inputType: 'selection',
      schema,
      options,
    });
    expect(result.inputRequired.schema).toEqual(schema);
    expect(result.inputRequired.options).toEqual(options);
  });
});

// ---------------------------------------------------------------------------
// 7. toolInputRequiredEvent helper
// ---------------------------------------------------------------------------

describe('toolInputRequiredEvent()', () => {
  it('generates an inputId when not provided', () => {
    const toolCall = {
      id: 'call-1',
      type: 'function' as const,
      function: { name: 'my_tool', arguments: { foo: 'bar' } },
    };
    const event = toolInputRequiredEvent(toolCall, { inputType: 'data', prompt: 'Need something' });

    expect(event.kind).toBe('tool-input-required');
    expect(event.toolCallId).toBe('call-1');
    expect(event.toolName).toBe('my_tool');
    expect(event.toolArguments).toEqual({ foo: 'bar' });
    expect(event.inputId).toBeTruthy();
    expect(event.inputType).toBe('data');
    expect(event.prompt).toBe('Need something');
  });

  it('uses the provided inputId', () => {
    const toolCall = {
      id: 'call-2',
      type: 'function' as const,
      function: { name: 'tool', arguments: {} },
    };
    const event = toolInputRequiredEvent(toolCall, {
      inputId: 'preset-id',
      inputType: 'confirmation',
      prompt: 'Are you sure?',
    });

    expect(event.inputId).toBe('preset-id');
  });

  it('two events for different tool calls get different inputIds by default', () => {
    const makeCall = (id: string) => ({
      id,
      type: 'function' as const,
      function: { name: 'tool', arguments: {} },
    });

    const e1 = toolInputRequiredEvent(makeCall('c1'), { inputType: 'data', prompt: 'p' });
    const e2 = toolInputRequiredEvent(makeCall('c2'), { inputType: 'data', prompt: 'p' });

    expect(e1.inputId).not.toBe(e2.inputId);
  });
});
