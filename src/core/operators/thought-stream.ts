/**
 * RxJS operator for streaming thought extraction
 *
 * SIMPLIFIED APPROACH: Since we work with accumulated content (not deltas),
 * we can simply extract thoughts from the accumulated content each chunk,
 * compute the delta of cleaned content, and emit only what's new.
 */

import type { Observable, OperatorFunction } from 'rxjs';
import { concatMap, scan } from 'rxjs/operators';
import type { LLMResponse } from '../types';
import type { LoopEventEmitter } from './event-emitter';

interface ThoughtBuffer {
  // Last cleaned content we emitted (thoughts removed)
  lastCleanedContent: string;
  // Set of already-emitted thoughts (to avoid duplicates)
  emittedThoughts: Set<string>;
  // Chunk index for events
  chunkIndex: number;
}

interface StreamEvent {
  kind: 'content-delta' | 'thought';
  content: string;
  chunkIndex: number;
  metadata?: Record<string, unknown>;
}

/**
 * Extract thoughts from streaming LLM responses
 *
 * Processes each chunk and emits:
 * - content-delta events for regular content (with thinking tags removed)
 * - thought-stream events for complete thoughts
 */
export function extractThoughtsFromStream(
  taskId: string,
  contextId: string,
  eventEmitter: LoopEventEmitter
): OperatorFunction<LLMResponse, LLMResponse> {
  const buffer: ThoughtBuffer = {
    lastCleanedContent: '',
    emittedThoughts: new Set(),
    chunkIndex: -1,
  };

  return (source: Observable<LLMResponse>) =>
    source.pipe(
      scan(
        (acc, response) => {
          acc.chunkIndex++;
          return { response, chunkIndex: acc.chunkIndex };
        },
        { response: null as unknown as LLMResponse, chunkIndex: -1 }
      ),

      concatMap(({ response, chunkIndex }) => {
        // Process this chunk and extract events synchronously
        const events = processChunk(response, chunkIndex, buffer);

        // Emit all events in order BEFORE returning the response
        for (const event of events) {
          if (event.kind === 'content-delta') {
            eventEmitter?.emitContentDelta(taskId, contextId, event.content, event.chunkIndex);
          } else if (event.kind === 'thought') {
            eventEmitter?.emitThought(taskId, contextId, 'reasoning', event.content, {
              verbosity: 'normal',
              metadata: event.metadata,
            });
          }
        }

        // Return the original response unchanged
        return [response];
      })
    );
}

/**
 * Process a single chunk and extract events
 *
 * Strategy:
 * 1. Extract all complete <thinking> tags from accumulated content
 * 2. Emit thought events for new thoughts
 * 3. Remove tags to get cleaned content
 * 4. Check if we're in the middle of an incomplete tag
 * 5. If yes, only emit content before the incomplete tag
 * 6. Compute delta from last cleaned content
 * 7. Emit content-delta for new content
 */
function processChunk(
  response: LLMResponse,
  chunkIndex: number,
  buffer: ThoughtBuffer
): StreamEvent[] {
  const events: StreamEvent[] = [];

  if (!response.message.content) {
    return events;
  }

  const accumulated = response.message.content;

  // Extract thoughts and get cleaned content
  let cleanedContent = accumulated;

  // Extract all complete <thinking> tags - three formats:
  // 1. <thinking>content</thinking> (content between tags)
  // 2. <thinking thought="content" ...></thinking> (attributes with closing tag)
  // 3. <thinking thought="content" ... /> (self-closing with attributes)

  // Format 1: Content between tags
  cleanedContent = cleanedContent.replace(
    /<thinking>(.*?)<\/thinking>/gs,
    (_match, thoughtContent) => {
      const trimmed = thoughtContent.trim();

      // Only emit if we haven't seen this thought before
      if (trimmed && !buffer.emittedThoughts.has(trimmed)) {
        buffer.emittedThoughts.add(trimmed);
        events.push({
          kind: 'thought',
          content: trimmed,
          chunkIndex,
          metadata: {
            source: 'content', // Extracted from LLM content
          },
        });
      }

      return ''; // Remove the tag from content
    }
  );

  // Helper function to extract thought from attributes
  const extractThoughtFromAttributes = (attributes: string) => {
    const thoughtMatch = attributes.match(/thought="([^"]*)"/);
    if (thoughtMatch) {
      const thoughtContent = thoughtMatch[1].trim();

      // Only emit if we haven't seen this thought before
      if (thoughtContent && !buffer.emittedThoughts.has(thoughtContent)) {
        buffer.emittedThoughts.add(thoughtContent);

        // Extract other attributes if available
        const thoughtTypeMatch = attributes.match(/thought_type="([^"]*)"/);
        const confidenceMatch = attributes.match(/confidence="([^"]*)"/);

        const metadata: Record<string, unknown> = {
          verbosity: 'normal',
        };

        if (thoughtTypeMatch) {
          metadata.thoughtType = thoughtTypeMatch[1];
        }
        if (confidenceMatch) {
          metadata.confidence = parseFloat(confidenceMatch[1]) || 0.5;
        }

        events.push({
          kind: 'thought',
          content: thoughtContent,
          chunkIndex,
          metadata: {
            ...metadata,
            source: 'content', // Extracted from LLM content
          },
        });
      }
    }
  };

  // Format 2: Attributes with closing tag
  cleanedContent = cleanedContent.replace(
    /<thinking\s+([^>]*)><\/thinking>/gs,
    (_match, attributes) => {
      extractThoughtFromAttributes(attributes);
      return ''; // Remove the tag from content
    }
  ); // Format 3: Self-closing tags with attributes
  cleanedContent = cleanedContent.replace(/<thinking\s+([^>]*?)\/>/gs, (_match, attributes) => {
    extractThoughtFromAttributes(attributes);
    return ''; // Remove the tag from content
  });

  // Check for incomplete opening tag
  // Could be a complete "<thinking>" or a partial like "<", "<t", "<th", etc.
  const incompleteTagIndex = cleanedContent.indexOf('<thinking>');
  if (incompleteTagIndex !== -1) {
    // We have an opening tag without a closing tag - don't emit content past it
    cleanedContent = cleanedContent.substring(0, incompleteTagIndex);
  } else {
    // Check for partial opening tag at the end
    const openingTag = '<thinking>';
    for (let len = 1; len < openingTag.length; len++) {
      const partial = openingTag.substring(0, len);
      if (cleanedContent.endsWith(partial)) {
        // Found a partial tag - trim it off
        cleanedContent = cleanedContent.substring(0, cleanedContent.length - len);
        break;
      }
    }
  }

  // Clean up extra whitespace left by tag removal
  cleanedContent = cleanedContent.replace(/\n\s*\n\s*\n/g, '\n\n');

  // Compute delta: what's new since last chunk
  const delta = cleanedContent.substring(buffer.lastCleanedContent.length);

  if (delta) {
    events.push({
      kind: 'content-delta',
      content: delta,
      chunkIndex,
    });
  }

  // Update buffer for next chunk
  buffer.lastCleanedContent = cleanedContent;

  return events;
}
