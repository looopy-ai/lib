export interface Skill {
  name: string;
  description: string;
  instruction: string | (() => Promise<string>);
}

export interface SkillRegistration {
  [key: string]: Skill;
}
