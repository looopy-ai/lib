
import { z } from 'zod';
import {
  type ToolDefinition,
  type ToolResult,
  type Message,
  type LocalTool,
} from '../types';
import { SkillRegistry } from '../skills/registry';

export const learnSkillToolName = 'learn_skill';

export const learnSkillToolDefinition: ToolDefinition = {
  name: learnSkillToolName,
  description: 'Learns a new skill from the available skill registry.',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'The name of the skill to learn.' },
    },
    required: ['name'],
  },
};

export function createLearnSkillTool(
  skillRegistry: SkillRegistry,
): LocalTool<z.ZodObject<{ name: z.ZodString }>> {
  return {
    definition: learnSkillToolDefinition,
    execute: async ({ name }: { name: string }) => {
      const skill = skillRegistry.get(name);

      if (!skill) {
        const availableSkills = skillRegistry
          .list()
          .map((s) => `'${s.name}'`)
          .join(', ');
        return {
          success: false,
          result: `Skill '${name}' not found. Available skills are: ${availableSkills}`,
        };
      }

      const systemMessage: Message = {
        role: 'system',
        content: `You have learned the following skill:\n\n**${skill.name}**\n${skill.instruction}`,
      };

      return {
        success: true,
        result: `Successfully learned the '${name}' skill.`,
        messages: [systemMessage],
      };
    },
  };
}
