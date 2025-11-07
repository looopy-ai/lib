import { filter, mergeMap, Observable, type OperatorFunction, pipe } from 'rxjs';
import type { Choice, ToolCall } from './types';

type ToolCallFragment = {
  index: number;
  id?: string | null;
  function?: {
    name?: string;
    arguments?: string; // chunk to append
  };
  type?: 'function';
};

type Acc = {
  id: string | null;
  name: string | undefined;
  args: string; // concatenated JSON string chunks
  emitted: boolean; // prevent double-emits
};

export const getToolCalls = <T extends Choice>() =>
  pipe(
    filter((choice: T) => !!choice.delta?.tool_calls),
    mergeMap((choice) => choice.delta?.tool_calls as ToolCall[])
  );

const tryParseJson = (s: string): boolean => {
  const trimmed = s.trim();
  if (!trimmed) return false;
  const startsOk = trimmed.startsWith('{') || trimmed.startsWith('[');
  const endsOk = trimmed.endsWith('}') || trimmed.endsWith(']');
  if (!startsOk || !endsOk) return false;
  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    return false;
  }
};

/**
 * Assemble streamed tool call fragments into complete ToolCalls.
 *
 * Emits a ToolCall when:
 *  - we have a name (eventually provided in a fragment), AND
 *  - arguments buffer parses as valid JSON.
 *
 * Any remaining parsable buffers are flushed on source completion.
 */
export const assembleToolCalls = (): OperatorFunction<ToolCallFragment, ToolCall> => (source) =>
  new Observable<ToolCall>((subscriber) => {
    const byIndex = new Map<number, Acc>();

    const maybeEmit = (idx: number) => {
      const acc = byIndex.get(idx);
      if (!acc || acc.emitted) return;
      if (!acc.name) return;
      if (!tryParseJson(acc.args)) return;

      subscriber.next({
        index: idx,
        id: acc.id ?? null,
        function: {
          name: acc.name,
          arguments: acc.args,
        },
        type: 'function',
      });

      acc.emitted = true;
    };

    const sub = source.subscribe({
      next: (frag) => {
        const idx = frag.index;
        const acc = byIndex.get(idx) ?? { id: null, name: undefined, args: '', emitted: false };

        if (frag.id !== undefined) acc.id = frag.id;
        if (frag.function?.name) acc.name = frag.function.name;
        if (frag.function?.arguments) acc.args += frag.function.arguments;

        byIndex.set(idx, acc);
        maybeEmit(idx);
      },
      error: (err) => subscriber.error(err),
      complete: () => {
        for (const [idx, acc] of byIndex.entries()) {
          if (!acc.emitted && acc.name && tryParseJson(acc.args)) {
            subscriber.next({
              index: idx,
              id: acc.id ?? null,
              function: { name: acc.name, arguments: acc.args },
              type: 'function',
            });
          }
        }
        subscriber.complete();
      },
    });

    return () => sub.unsubscribe();
  });
