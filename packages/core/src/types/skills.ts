export interface Skill {
  name: string;
  description: string;
  instruction: string;
}

export interface SkillRegistration {
  [key: string]: Skill;
}
