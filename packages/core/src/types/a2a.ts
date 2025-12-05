import type { LLMMessage } from './message';

/**
 * Task state as defined by A2A protocol
 */
export type A2ATaskState =
  | 'submitted'
  | 'working'
  | 'input-required'
  | 'completed'
  | 'canceled'
  | 'failed'
  | 'rejected'
  | 'auth-required'
  | 'unknown';

/**
 * Task status for A2A protocol
 */
export interface A2ATaskStatus {
  state: A2ATaskState;
  message?: LLMMessage;
  timestamp?: string; // ISO 8601
}

/**
 * Part types for A2A protocol artifacts
 */
export type A2APart = A2ATextPart | A2AFilePart | A2ADataPart;

export interface A2ATextPart {
  kind: 'text';
  text: string;
  metadata?: Record<string, unknown>;
}

export interface A2AFilePart {
  kind: 'file';
  file: {
    name?: string;
    mimeType?: string;
    bytes?: string; // Base64 encoded
    uri?: string;
  };
  metadata?: Record<string, unknown>;
}

export interface A2ADataPart {
  kind: 'data';
  data: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

/**
 * A2A Artifact structure
 */
export interface A2AArtifact {
  artifactId: string;
  name?: string;
  description?: string;
  parts: A2APart[];
  metadata?: Record<string, unknown>;
  extensions?: string[];
}
