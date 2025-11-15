export type SerializedError = {
  name: string;
  message: string;
  stack?: string;
  cause?: SerializedError;
  [key: string]: unknown;
};

/**
 * Serializes an Error object into a plain object.
 * @param {Error} error
 * @returns {object}
 */
export const serializeError = (error: unknown): SerializedError => {
  if (error instanceof Error) {
    return {
      ...error, // Copies enumerable properties (like 'code', 'statusCode')
      name: error.name,
      message: error.message,
      stack: error.stack,
      // Recursively serialize the 'cause' if it exists (Node.js 16.9.0+)
      cause: error.cause ? serializeError(error.cause) : undefined,
    };
  }

  if (typeof error === 'object' && error !== null) {
    return {
      name: 'NonErrorObject',
      message: 'An error occurred, but it is not an instance of Error.',
      ...error,
      cause: 'cause' in error && error.cause ? serializeError(error.cause) : undefined,
    };
  }

  // Fallback for non-Error objects
  return {
    name: 'NonObjectError',
    message: JSON.stringify(error),
  };
};
