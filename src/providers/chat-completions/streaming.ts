import { filter, map, mergeMap, pipe } from 'rxjs';
import type { Choice, LLMUsage } from './types';

type ChatCompletionStreamData = {
  id: string;
  created: number;
  model: string;
  object: string;
  choices: Choice[];
  usage?: LLMUsage;
};

export const choices = <T extends ChatCompletionStreamData>() =>
  pipe(
    mergeMap((data: T) => data.choices),
    filter((choice) => !!choice),
  );

export const usage = <T extends ChatCompletionStreamData>() =>
  pipe(
    map((data: T) => data.usage),
    filter((usage) => !!usage),
  );
