import { mergeMap, pipe } from 'rxjs';
import type { Choice } from './types';

type ChatCompletionStreamData = {
  id: string;
  created: number;
  model: string;
  object: string;
  choices: Choice[];
};

export const choices = <T extends ChatCompletionStreamData>() =>
  pipe(mergeMap((data: T) => data.choices));
