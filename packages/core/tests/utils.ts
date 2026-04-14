import { context } from '@opentelemetry/api';
import pino from 'pino';
import type { IterationContext } from '../src/types/core';

export const mockIterationContext = (): IterationContext<unknown> => ({
  taskId: 'test-task',
  contextId: 'test-context',
  agentId: 'test-agent',
  parentContext: context.active(),
  plugins: [],
  logger: pino(),
  turnNumber: 1,
});
