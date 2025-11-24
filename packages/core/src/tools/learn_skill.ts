import { z } from 'zod';
import type { SkillRegistry } from '../skills/registry';
import type { Message } from '../types';
import { tool } from './local-tools';

export const learnSkillToolName = 'learn_skill';

export function createLearnSkillTool(skillRegistry: SkillRegistry) {
  return tool({
    name: learnSkillToolName,
    description: 'Learns a new skill from the available skill registry.',
    schema: z.object({
      name: z.string().describe('The name of the skill to learn.'),
    }),
    handler: async ({ name }: { name: string }) => {
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
  });
}
