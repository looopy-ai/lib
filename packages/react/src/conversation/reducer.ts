import type { SSEEvent } from '@geee-be/sse-stream-parser';
import { reduceContentComplete } from './events/content-complete';
import { reduceContentDelta } from './events/content-delta';
import { reduceTaskComplete } from './events/task-complete';
import { reduceTaskCreated } from './events/task-created';
import { reduceTaskStatus } from './events/task-status';
import { reduceThoughtStream } from './events/thought-stream';
import { reduceToolComplete } from './events/tool-complete';
import { reduceToolStart } from './events/tool-start';
import type { ConversationState } from './types';

export const conversationReducer = (
  state: ConversationState,
  event: SSEEvent,
): ConversationState => {
  const data = event.data ? JSON.parse(event.data) : null;
  if (!data) return state;

  switch (event.event) {
    case 'task-created':
      // {"taskId":"~","initiator":"user","timestamp":"2025-11-18T07:04:58.040Z","metadata":{"historyLength":7}}
      return reduceTaskCreated(state, data);
    case 'task-status':
      return reduceTaskStatus(state, data);
    case 'content-delta':
      return reduceContentDelta(state, data);
    case 'content-complete':
      return reduceContentComplete(state, data);
    case 'task-complete':
      return reduceTaskComplete(state, data);
    case 'thought-stream':
      return reduceThoughtStream(state, data);
    case 'tool-start':
      return reduceToolStart(state, data);
    case 'tool-complete':
      return reduceToolComplete(state, data);
    default:
      return state;
  }
};
