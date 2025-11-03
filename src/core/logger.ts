/**
 * Logger Configuration
 *
 * Provides structured logging using Pino with contextual information.
 * Supports both development (pretty) and production (JSON) output.
 */

import pino from 'pino';

/**
 * Log levels
 */
export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

/**
 * Logger configuration
 */
export interface LoggerConfig {
  /** Log level (default: info) */
  level?: LogLevel;

  /** Pretty print for development (default: false) */
  pretty?: boolean;

  /** Additional context to include in all logs */
  context?: Record<string, unknown>;
}

/**
 * Create a logger instance
 */
export function createLogger(config: LoggerConfig = {}): pino.Logger {
  const { level = 'info', pretty = false, context = {} } = config;

  const pinoConfig: pino.LoggerOptions = {
    level,
    base: context,
    timestamp: pino.stdTimeFunctions.isoTime,
  };

  if (pretty) {
    return pino(
      pinoConfig,
      pino.transport({
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'HH:MM:ss.l',
          ignore: 'pid,hostname',
          singleLine: false,
        },
      })
    );
  }

  return pino(pinoConfig);
}

/**
 * Default logger instance
 * Can be overridden by setting DEFAULT_LOGGER
 */
export let DEFAULT_LOGGER = createLogger({
  level: (process.env.LOG_LEVEL as LogLevel) || 'info',
  pretty: process.env.NODE_ENV !== 'production',
});

/**
 * Set the default logger
 */
export function setDefaultLogger(logger: pino.Logger): void {
  DEFAULT_LOGGER = logger;
}

/**
 * Get a child logger with additional context
 */
export function getLogger(context: Record<string, unknown>): pino.Logger {
  return DEFAULT_LOGGER.child(context);
}
