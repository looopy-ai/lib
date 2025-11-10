# Content-Delta Event Ordering Fix

## Issue

Content-delta events were being displayed out of order in the kitchen-sink console, even though the SSE log showed them arriving in the correct sequence.

### Symptoms

- SSE log shows events in correct order (e.g., "Hi", " there", "!", " It", " looks")
- Console output shows jumbled text (e.g., "Hi It there! looks")
- The final `content-complete` event shows the correct aggregated content

### Root Cause

The issue was in `examples/kitchen-sink.ts`, where content-delta events were handled using:

```typescript
case 'content-delta':
  process.stdout.write(event.delta);
  break;
```

**Problem**: `process.stdout.write()` is asynchronous and non-blocking. When multiple content-delta events arrive rapidly in succession (which happens during LLM streaming), the writes can complete out of order:

1. Event 1: "Hi" → starts write
2. Event 2: " there" → starts write (before Event 1 finishes)
3. Event 3: "!" → starts write
4. Event 2 write completes → displays " there"
5. Event 1 write completes → displays "Hi" (out of order!)
6. Event 3 write completes → displays "!"

RxJS observables emit events synchronously and in order, but the async stdout writes don't preserve that ordering.

## Solution

Use synchronous stdout writes to naturally preserve order:

```typescript
import fs from 'node:fs';

async function handleAgentEvent(event) {
  switch (event.kind) {
    case 'content-delta':
      // Use synchronous write to preserve order
      fs.writeSync(process.stdout.fd, event.delta);
      break;

    case 'content-complete':
      console.log(`\n\n📦 Content completed:\n${event.content}`);
      break;
  }
}
```

### How It Works

1. **Synchronous Write**: `fs.writeSync()` blocks until the write completes
2. **Natural Ordering**: Since each write blocks, subsequent writes wait automatically
3. **No Queue Needed**: Synchronous nature eliminates the need for promise chaining
4. **Simple & Reliable**: Fewer moving parts, easier to understand and maintain

### Benefits

- ✅ Content-delta events display in correct order
- ✅ No race conditions between rapid writes
- ✅ Preserves streaming UX (text appears as it arrives)
- ✅ Extremely simple implementation (one line!)
- ✅ No need for promise queues or async coordination
- ✅ Synchronous by design = guaranteed ordering

## Files Modified

- `examples/kitchen-sink.ts`:
  - Added `import fs from 'node:fs'` (synchronous fs operations)
  - Changed `import * as fs from 'node:fs/promises'` to `import * as fsPromises from 'node:fs/promises'`
  - Updated all async fs calls to use `fsPromises`
  - Modified `content-delta` handler to use `fs.writeSync(process.stdout.fd, event.delta)`

## Testing

To verify the fix:

1. Run kitchen-sink: `pnpm tsx examples/kitchen-sink.ts`
2. Send a message that triggers streaming (e.g., "Hi there")
3. Observe that streamed content appears in correct order
4. Compare console output with SSE log to confirm ordering matches

## Technical Notes

### Why `process.stdout.write()` is async

Node.js stdout is implemented as a stream with an internal buffer. When you call `write()`, it may:
- Write immediately (if buffer has space)
- Queue the write (if buffer is full)
- Return before the data is actually written to the terminal

The callback in `write(data, callback)` fires when the write actually completes, which may be delayed.

### Alternative Solutions Considered

1. **Promise Queue**: Chain writes with promises
   - Rejected: More complex than needed, requires queue management

2. **Buffering**: Collect all deltas, write once at end
   - Rejected: Loses streaming UX benefit

3. **Synchronous writes** (chosen): Use `fs.writeSync(process.stdout.fd, data)`
   - Accepted: Simple, guaranteed ordering, minimal code

### Performance Impact

Negligible. While `writeSync()` blocks the event loop during the write, stdout writes are typically very fast (microseconds). The blocking time is much shorter than the interval between LLM streaming chunks, so there's no perceptible impact on streaming UX. The simplicity and reliability of synchronous writes outweighs any theoretical async performance benefit.

## Related

- SSE Logging Feature: `SSE_LOGGING_FEATURE.md`
- Content Processing: `XML_TAG_STRIPPING_IN_AGGREGATION.md`
- Streaming Architecture: `design/streaming-architecture.md`
