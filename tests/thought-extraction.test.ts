/**
 * Tests for thought extraction from LLM responses
 *
 * NOTE: Thought extraction logic is now implemented in the LLM provider operators
 * (see src/core/operators/chat-completions/content.ts - splitInlineXml).
 * These tests should be at the operator level, not at the AgentLoop integration level.
 *
 * For thought extraction operator tests, see:
 * - tests/content.test.ts (splitInlineXml tests)
 * - Integration tests in tests/litellm-streaming-integration.test.ts
 */

import { describe, it } from 'vitest';

describe('Thought Extraction', () => {
  it('should test thought extraction at the operator level', () => {
    // Thought extraction is tested in:
    // - tests/content.test.ts (splitInlineXml operator)
    // - tests/litellm-streaming-integration.test.ts (integration)
    // This file is kept for reference but tests have been moved to appropriate locations
  });
});
