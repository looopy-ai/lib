# Thought Stream Extraction - Supported Formats

The thought stream extraction operator supports **three different formats** for `<thinking>` tags in LLM responses.

## Supported Formats

### Format 1: Content Between Tags

The original format where the thought content is between opening and closing tags.

```xml
<thinking>This is the thought content</thinking>
```

**Example:**
```xml
Let me analyze this. <thinking>I need to verify the calculation first</thinking> The answer is 42.
```

**Extracted:**
- Thought: `"I need to verify the calculation first"`
- Content: `"Let me analyze this.  The answer is 42."`

---

### Format 2: Attributes with Closing Tag

Thought content specified in the `thought` attribute with additional metadata attributes.

```xml
<thinking thought="content" thought_type="type" confidence="0.7"></thinking>
```

**Example:**
```xml
Let me analyze this. <thinking thought_id="date_calculation_failure" thought="It seems there is still an issue with the date calculation. The datetime function may not be available either. I will need to use a different approach or inform the user." thought_type="reflection" confidence="0.7"></thinking> I apologize, but I am unable to calculate dates.
```

**Extracted:**
- Thought: `"It seems there is still an issue with the date calculation..."`
- Metadata:
  - `thoughtType`: `"reflection"`
  - `confidence`: `0.7`
- Content: `"Let me analyze this.  I apologize, but I am unable to calculate dates."`

---

### Format 3: Self-Closing Tag with Attributes

A self-closing tag variant of Format 2.

```xml
<thinking thought="content" thought_type="type" confidence="0.7" />
```

**Example:**
```xml
Analyzing... <thinking thought="Need to verify the calculation" thought_type="verification" confidence="0.9" /> The result is correct.
```

**Extracted:**
- Thought: `"Need to verify the calculation"`
- Metadata:
  - `thoughtType`: `"verification"`
  - `confidence`: `0.9`
- Content: `"Analyzing...  The result is correct."`

---

## Metadata Extraction

For formats 2 and 3 (attribute-based), the following attributes are automatically extracted:

| Attribute | Description | Type | Default |
|-----------|-------------|------|---------|
| `thought` | The thought content (required) | `string` | - |
| `thought_type` | Type of thought (e.g., "reflection", "verification") | `string` | - |
| `confidence` | Confidence level of the thought | `number` | `0.5` |

Additional attributes like `thought_id` are ignored but don't break parsing.

---

## Event Output

All formats emit the same event structure:

```typescript
{
  kind: 'thought-stream',
  taskId: string,
  contextId: string,
  thoughtType: 'reasoning',  // Always 'reasoning' for now
  thought: string,           // The extracted thought content
  metadata: {
    verbosity: 'normal',
    thoughtType?: string,    // From attribute (formats 2 & 3)
    confidence?: number,     // From attribute (formats 2 & 3)
  }
}
```

---

## Streaming Behavior

The operator handles incomplete tags correctly during streaming:

### Complete Tag in Single Chunk
```typescript
// Chunk 1: "Text <thinking>thought</thinking> more"
// → Emits: thought-stream event
// → Emits: content-delta "Text  more"
```

### Tag Split Across Chunks
```typescript
// Chunk 1: "Text <thinking>thou"
// → Emits: content-delta "Text " (tag buffered)

// Chunk 2: "Text <thinking>thought</thinking>"
// → Emits: thought-stream event
// → Emits: No delta (already emitted "Text ")

// Chunk 3: "Text <thinking>thought</thinking> more"
// → Emits: content-delta " more"
```

### Partial Tag Detection
```typescript
// Chunk 1: "Text <think"
// → Emits: content-delta "Text " (partial tag buffered)

// Chunk 2: "Text <thinking>thought</thinking>"
// → Emits: thought-stream event
// → Emits: No delta
```

Partial tags detected: `<`, `<t`, `<th`, `<thi`, `<thin`, `<think`, `<thinki`, `<thinkin`

---

## Implementation

See `src/core/operators/thought-stream.ts` for the implementation.

### Test Files

- `tests/manual-thought-test.ts` - Format 1 with split tags
- `tests/thought-streaming-edge-cases.ts` - Multiple thoughts and partial tags
- `tests/thought-attribute-format.ts` - Format 2 with closing tag
- `tests/thought-self-closing.ts` - Format 3 self-closing tag
- `tests/thought-extraction.test.ts` - Unit tests

All tests passing: ✅ 133/133
