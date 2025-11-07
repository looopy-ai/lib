import { mergeMap, pipe } from 'rxjs';
import { Choice } from './types';

type ChatCompletionStreamData = {
  id: string;
  created: string;
  model: string;
  object: string;
  choices: Array<Choice>
}

export const choices = <T extends ChatCompletionStreamData>() => pipe(
  mergeMap((data: T) => data.choices)
);
