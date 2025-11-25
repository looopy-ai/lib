import z from 'zod';
import { tool } from '../tools/local-tools';
import type { Message, Skill, SkillRegistration } from '../types';

export const learnSkillToolName = 'learn_skill';

export class SkillRegistry {
  private skills: SkillRegistration = {};

  constructor(skills: Skill[] = []) {
    skills.forEach((skill) => {
      this.skills[skill.name] = skill;
    });
  }

  register(skill: Skill) {
    this.skills[skill.name] = skill;
  }

  get(name: string): Skill | undefined {
    return this.skills[name];
  }

  list(): Skill[] {
    return Object.values(this.skills);
  }

  tool() {
    return tool({
      name: learnSkillToolName,
      description: 'Learns a new skill from the available skill registry.',
      schema: z.object({
        name: z.string().describe('The name of the skill to learn.'),
      }),
      handler: async ({ name }: { name: string }) => {
        const skill = this.get(name);

        if (!skill) {
          const availableSkills = this.list()
            .map((s) => `'${s.name}'`)
            .join(', ');
          return {
            success: false,
            result: null,
            error: `Skill '${name}' not found. Available skills are: ${availableSkills}`,
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
}
