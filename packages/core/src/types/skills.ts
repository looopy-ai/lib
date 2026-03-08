export interface Skill {
  name: string;
  description: string;
  instruction: string | (() => Promise<string>);
}

export interface MaterializedSkill {
  name: string;
  description: string;
  instruction: string;
}

export interface SkillRegistration {
  [key: string]: Skill;
}
