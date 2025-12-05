import z from 'zod';
import { tool } from '../tools/local-tools';
import type { LLMMessage, Skill, SkillRegistration } from '../types';

export const learnSkillToolName = 'learn_skill';

const getInstruction = async (instruction: string | (() => Promise<string>)): Promise<string> => {
  if (typeof instruction === 'string') {
    return instruction;
  }
  return await instruction();
};

export const skill = (definition: Skill): Skill => {
  return { ...definition };
};

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
      icon: 'lucide:graduation-cap',
      description: 'Learns a new skill from the available skill registry.',
      schema: z.object({
        name: z.string().describe('The name of the skill to learn.'),
      }),
      handler: async ({ name }: { name: string }) => {
        const foundSkill = this.get(name);

        if (!foundSkill) {
          const availableSkills = this.list()
            .map((s) => `'${s.name}'`)
            .join(', ');
          return {
            success: false,
            result: null,
            error: `Skill '${name}' not found. Available skills are: ${availableSkills}`,
          };
        }

        const systemMessage: LLMMessage = {
          role: 'system',
          content: `You have learned the following skill:\n\n**${foundSkill.name}**\n${await getInstruction(foundSkill.instruction)}`,
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
