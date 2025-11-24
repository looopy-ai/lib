import { from } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { Agent } from '../src/core/agent';
import { SkillRegistry } from '../src/skills';
import { createLearnSkillTool } from '../src/tools/learn_skill';
import { localTools } from '../src/tools/local-tools';
import type { AnyEvent } from '../src/types';

describe('Skill Learning', () => {
  const mockLLMProvider = {
    call: vi.fn(),
  };

  const mockMessageStore = {
    getAll: vi.fn().mockResolvedValue([]),
    append: vi.fn(),
    clear: vi.fn(),
    getRecent: vi.fn().mockResolvedValue([]),
    compact: vi.fn(),
    getCount: vi.fn().mockResolvedValue(0),
    getRange: vi.fn().mockResolvedValue([]),
  };

  const mockAgentStore = {
    load: vi.fn(),
    save: vi.fn(),
  };

  const diagramTool = {
    name: 'diagram',
    description: 'Renders a Mermaid diagram.',
    schema: z.object({
      diagram: z.string(),
    }),
    handler: vi.fn(),
  };

  const skillRegistry = new SkillRegistry([
    {
      name: 'diagrammer',
      description: 'learn how to draw diagrams by using Mermaid markdown',
      instruction:
        'To draw a diagram, use the `diagram` tool with the `diagram` parameter containing the Mermaid markdown.',
    },
  ]);

  it('should add a skill to the message history when learned', async () => {
    const learnSkillTool = createLearnSkillTool(skillRegistry);
    const localToolProvider = localTools([learnSkillTool, diagramTool]);

    const agent = new Agent({
      agentId: 'test-agent',
      contextId: 'test-context',
      llmProvider: mockLLMProvider,
      toolProviders: [localToolProvider],
      messageStore: mockMessageStore,
      agentStore: mockAgentStore,
      skillRegistry,
    });

    mockLLMProvider.call.mockReturnValueOnce(
      from([
        {
          kind: 'tool-call',
          toolCall: {
            id: 'tool-call-1',
            type: 'function',
            function: {
              name: 'learn_skill',
              arguments: { name: 'diagrammer' },
            },
          },
        },
        {
          kind: 'content-complete',
          content: '',
          finishReason: 'tool_calls',
          toolCalls: [
            {
              id: 'tool-call-1',
              type: 'function',
              function: {
                name: 'learn_skill',
                arguments: { name: 'diagrammer' },
              },
            },
          ],
        },
      ]),
    );
    mockMessageStore.getRecent.mockResolvedValue([]);

    const events$ = await agent.startTurn('learn the diagrammer skill');
    const events = await new Promise<AnyEvent[]>((resolve) => {
      const events: AnyEvent[] = [];
      events$.subscribe({
        next: (event) => events.push(event),
        complete: () => resolve(events),
      });
    });

    const toolCompleteEvent = events.find((e) => e.kind === 'tool-complete');
    expect(toolCompleteEvent).toBeDefined();
    if (!toolCompleteEvent) return;
    expect(toolCompleteEvent.success).toBe(true);
    expect(toolCompleteEvent.result).toBe("Successfully learned the 'diagrammer' skill.");

    const messageEvent = events.find((e) => e.kind === 'message');
    expect(messageEvent).toBeDefined();
    if (!messageEvent) return;
    expect(messageEvent.message.role).toBe('system');
    expect(messageEvent.message.content).toContain('You have learned the following skill:');
  });

  it('should return an error when trying to learn a non-existent skill', async () => {
    const learnSkillTool = createLearnSkillTool(skillRegistry);
    const localToolProvider = localTools([learnSkillTool, diagramTool]);

    const agent = new Agent({
      agentId: 'test-agent',
      contextId: 'test-context',
      llmProvider: mockLLMProvider,
      toolProviders: [localToolProvider],
      messageStore: mockMessageStore,
      agentStore: mockAgentStore,
      skillRegistry,
    });

    mockLLMProvider.call.mockReturnValueOnce(
      from([
        {
          kind: 'tool-call',
          toolCall: {
            id: 'tool-call-1',
            type: 'function',
            function: {
              name: 'learn_skill',
              arguments: { name: 'non-existent-skill' },
            },
          },
        },
        {
          kind: 'content-complete',
          content: '',
          finishReason: 'tool_calls',
          toolCalls: [
            {
              id: 'tool-call-1',
              type: 'function',
              function: {
                name: 'learn_skill',
                arguments: { name: 'non-existent-skill' },
              },
            },
          ],
        },
      ]),
    );
    mockMessageStore.getRecent.mockResolvedValue([]);

    const events$ = await agent.startTurn('learn a non-existent skill');
    const events = await new Promise<AnyEvent[]>((resolve) => {
      const events: AnyEvent[] = [];
      events$.subscribe({
        next: (event) => events.push(event),
        complete: () => resolve(events),
      });
    });

    const toolCompleteEvent = events.find((e) => e.kind === 'tool-complete');
    expect(toolCompleteEvent).toBeDefined();
    if (!toolCompleteEvent) return;
    expect(toolCompleteEvent.success).toBe(false);
    expect(toolCompleteEvent.error).toContain("Skill 'non-existent-skill' not found.");
  });
});
