import { vi } from 'vitest';

type LogMethod = ReturnType<typeof vi.fn>;

interface ChildRecord {
  bindings?: Record<string, unknown>;
  logger: MockLogger;
}

export interface MockLogger {
  level: string;
  info: LogMethod;
  warn: LogMethod;
  error: LogMethod;
  debug: LogMethod;
  trace: LogMethod;
  fatal: LogMethod;
  flush: LogMethod;
  child: LogMethod;
  __children: ChildRecord[];
  __parent?: MockLogger;
  __bindings?: Record<string, unknown>;
}

/**
 * Helper to build a mock logger with all commonly used methods stubbed.
 *
 * Each `child()` call returns a fresh mock logger instance so tests can assert
 * on child-specific logging without needing to reconfigure the mock manually.
 */
export const createMockLogger = (): MockLogger => {
  const childRecords: ChildRecord[] = [];

  const logger: MockLogger = {
    level: 'info',
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
    fatal: vi.fn(),
    flush: vi.fn(),
    child: vi.fn(),
    __children: childRecords,
  };

  logger.child.mockImplementation((bindings?: Record<string, unknown>) => {
    const childLogger = createMockLogger();
    childLogger.__parent = logger;
    childLogger.__bindings = bindings;
    childRecords.push({ bindings, logger: childLogger });
    return childLogger;
  });

  return logger;
};

const stdTimeFunctions = {
  isoTime: vi.fn(() => new Date().toISOString()),
};

const destination = vi.fn(() => ({
  write: vi.fn(),
  flush: vi.fn(),
}));

const transport = vi.fn(() => ({
  stream: { write: vi.fn() },
}));

const pinoFactory = vi.fn(() => createMockLogger());

const mockedPino = Object.assign(pinoFactory, {
  pino: pinoFactory,
  stdTimeFunctions,
  destination,
  transport,
  default: pinoFactory,
});

export { destination, stdTimeFunctions, transport, mockedPino as pino };
export default mockedPino;
