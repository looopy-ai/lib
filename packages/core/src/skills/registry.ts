import { Skill, SkillRegistration } from '../types';

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
}
