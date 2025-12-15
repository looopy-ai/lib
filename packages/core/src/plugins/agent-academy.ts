import { catchError, defer, mergeMap, of } from 'rxjs';
import z from 'zod';
import { toolErrorEvent, toolResultToEvents } from '../tools/tool-result-events';
import type { LLMMessage, Skill } from '../types';
import type { ExecutionContext } from '../types/context';
import type { IterationContext, Plugin, SystemPrompt } from '../types/core';
import type { ToolCall, ToolDefinition } from '../types/tools';

export const learnSkillToolName = 'learn_skill';

export const getInstruction = async (
  instruction: string | (() => Promise<string>),
): Promise<string> => {
  if (typeof instruction === 'string') {
    return instruction;
  }
  return await instruction();
};

export const skill = (definition: Skill): Skill => {
  return { ...definition };
};

/**
 * Options for agent academy plugin
 */
export type AgentAcademyOptions<AuthContext> = {
  /**
   * Optional function to generate a system prompt about learning skills.
   * If provided, this prompt will be added before other messages with positionSequence=100.
   */
  learnSkillPrompt?: (
    skills: Skill[],
    context: IterationContext<AuthContext>,
  ) => Promise<string | SystemPrompt>;
};

/**
 * Create an agent academy plugin from skill definitions
 *
 * @example
 * const academyPlugin = agentAcademy([
 *   skill({
 *     name: 'diagramming',
 *     description: 'Create diagrams',
 *     instruction: 'You can create diagrams using mermaid syntax...'
 *   })
 * ]);
 *
 * @example
 * const academyPlugin = agentAcademy([diagrammerSkill], {
 *   learnSkillPrompt: async (context) => {
 *     return 'You can learn new skills using the learn_skill tool.';
 *   }
 * });
 */
export function agentAcademy<AuthContext>(
  skills: Skill[],
  options?: AgentAcademyOptions<AuthContext>,
): Plugin<AuthContext> {
  const skillMap = new Map<string, Skill>();

  for (const skill of skills) {
    if (skillMap.has(skill.name)) {
      throw new Error(`Duplicate skill name: ${skill.name}`);
    }
    skillMap.set(skill.name, skill);
  }

  const learnSkillToolDefinition: ToolDefinition = {
    id: learnSkillToolName,
    description: 'Learns a new skill from the available agent academy.',
    icon: 'lucide:graduation-cap',
    parameters: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'The name of the skill to learn.',
        },
      },
      required: ['name'],
    },
  };

  const learnSkillPromptFn = options?.learnSkillPrompt ?? defaultPrompt;

  return {
    name: 'agent-academy',

    generateSystemPrompts: async (
      context: IterationContext<AuthContext>,
    ): Promise<SystemPrompt[]> => {
      if (!learnSkillPromptFn) {
        return [];
      }

      const prompt = await learnSkillPromptFn(skills, context);
      if (typeof prompt === 'string') {
        return [
          {
            content: prompt,
            position: 'before',
            positionSequence: 100,
          },
        ];
      }
      return [
        {
          ...prompt,
          positionSequence: prompt.positionSequence ?? 100,
        },
      ];
    },

    listTools: async (): Promise<ToolDefinition[]> => {
      return [learnSkillToolDefinition];
    },

    getTool: async (toolId: string): Promise<ToolDefinition | undefined> => {
      if (toolId === learnSkillToolName) {
        return learnSkillToolDefinition;
      }
      return undefined;
    },

    executeTool: (toolCall: ToolCall, _context: ExecutionContext<AuthContext>) =>
      defer(async () => {
        if (toolCall.function.name !== learnSkillToolName) {
          return {
            toolCallId: toolCall.id,
            toolName: toolCall.function.name,
            success: false,
            result: null,
            error: `Tool ${toolCall.function.name} not found`,
          };
        }

        try {
          // Parse and validate arguments
          const schema = z.object({
            name: z.string().describe('The name of the skill to learn.'),
          });
          const validatedParams = schema.parse(toolCall.function.arguments);

          const foundSkill = skillMap.get(validatedParams.name);

          if (!foundSkill) {
            const availableSkills = Array.from(skillMap.values())
              .map((s) => `'${s.name}'`)
              .join(', ');
            return {
              toolCallId: toolCall.id,
              toolName: toolCall.function.name,
              success: false,
              result: null,
              error: `Skill '${validatedParams.name}' not found. Available skills are: ${availableSkills}`,
            };
          }

          const systemMessage: LLMMessage = {
            role: 'system',
            content: `You have learned the following skill:\n\n**${foundSkill.name}**\n${await getInstruction(foundSkill.instruction)}`,
          };

          return {
            toolCallId: toolCall.id,
            toolName: toolCall.function.name,
            success: true,
            result: `Successfully learned the '${validatedParams.name}' skill.`,
            messages: [systemMessage],
          };
        } catch (error) {
          // Handle Zod validation errors
          if (error instanceof z.ZodError) {
            return {
              toolCallId: toolCall.id,
              toolName: toolCall.function.name,
              success: false,
              result: null,
              error: `Invalid arguments: ${error.issues.map((e) => `${e.path.join('.')}: ${e.message}`).join(', ')}`,
            };
          }

          // Handle execution errors
          const err = error instanceof Error ? error : new Error(String(error));
          return {
            toolCallId: toolCall.id,
            toolName: toolCall.function.name,
            success: false,
            result: null,
            error: err.message,
          };
        }
      }).pipe(
        mergeMap((result) => toolResultToEvents(result)),
        catchError((error) =>
          of(toolErrorEvent(toolCall, error instanceof Error ? error.message : String(error))),
        ),
      ),
  };
}

const defaultPrompt = (skills: Skill[]): string => {
  const skillList = skills
    .map(
      (skill) =>
        `- **${skill.name}**: ${typeof skill.instruction === 'string' ? skill.instruction : 'A useful skill.'}`,
    )
    .join('\n');

  return `You can learn new skills using the learn_skill tool. The available skills are:\n\n${skillList}\n\nTo learn a skill, call the learn_skill tool with the name of the skill you want to learn.`;
};
