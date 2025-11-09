import { filter, map, type Observable, pipe, Subject } from 'rxjs';
import type { Choice } from './types';

export type InlineXml = {
  name: string;
  content?: string;
  attributes: Record<string, string | string[]>;
};

type SplitResult = {
  content: Observable<string>;
  tags: Observable<InlineXml>;
};

const parseAttributes = (attrsSrc: string): Record<string, string | string[]> => {
  const attrs: Record<string, string | string[]> = {};
  // Simple XML-like attr parser: key="value" or key='value' or key (boolean)
  const re = /([A-Za-z_:][\w:.-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>/]+)))?/g;
  let m: RegExpExecArray | null = re.exec(attrsSrc);
  while (m !== null) {
    const key = m[1];
    const val = m[2] ?? m[3] ?? m[4] ?? '';
    if (key in attrs) {
      const prev = attrs[key];
      attrs[key] = Array.isArray(prev) ? [...prev, val] : [prev, val];
    } else {
      attrs[key] = val;
    }
    m = re.exec(attrsSrc);
  }
  return attrs;
};

// Trim only at tag boundaries, otherwise preserve whitespace.
// If prev was a tag, trim left; if next is a tag, trim right.
const emitIfNonEmpty = (
  s: string,
  prevWasTag: boolean,
  nextIsTagAhead: boolean,
  push: (v: string) => void
) => {
  let out = s;
  if (prevWasTag) out = out.replace(/^\s+/, '');
  if (nextIsTagAhead) out = out.replace(/\s+$/, '');
  if (out.length > 0) push(out);
};

export const getContent = <T extends Choice>() =>
  pipe(
    filter((choice: T) => !!choice.delta?.content),
    map((choice) => choice.delta?.content as string)
  );

/**
 * splitInlineXml
 * Consumes a stream of text chunks that may contain inline XML-like tags.
 * Produces two streams:
 *   - content$: string chunks with tags removed (whitespace trimmed at tag boundaries only)
 *   - tags$: InlineXml objects extracted from the stream
 *
 * Notes:
 * - Handles tags across chunk boundaries (buffers internally)
 * - No nested tag parsing (opening tag must be closed before another of the same name starts)
 * - If a source chunk is fully consumed by tags, nothing is emitted on content$
 */
export const splitInlineXml = (source: Observable<string>): SplitResult => {
  const contentSubj = new Subject<string>();
  const tagsSubj = new Subject<InlineXml>();

  // Parser state
  let buffer = '';
  let prevEmittedWasTag = false;

  const flushParsable = () => {
    // Repeatedly scan buffer for next tag; emit content between tags;
    // try to parse full tags (self-closing OR paired).
    // Stop when there isn't a full tag (need more data) or no '<' present.
    while (true) {
      const lt = buffer.indexOf('<');
      if (lt === -1) {
        // No tags in buffer: nothing to parse further now.
        // We keep the buffer; we’ll emit on next chunk when we know
        // if a tag follows (to decide right-trim).
        return;
      }

      // There is text before the tag
      const before = buffer.slice(0, lt);
      // Peek ahead to confirm this looks like a tag at all
      const gt = buffer.indexOf('>', lt + 1);
      if (gt === -1) {
        // Incomplete tag head; wait for more data
        return;
      }

      // Emit the text before '<', trimming only the right edge (tag boundary)
      if (before.length) {
        emitIfNonEmpty(before, prevEmittedWasTag, true, (v) => contentSubj.next(v));
        prevEmittedWasTag = false; // last emission was content
      }

      // Now parse the tag head
      const tagHead = buffer.slice(lt + 1, gt).trim(); // excludes '<' and '>'
      // Remove consumed prefix (up to and including this '>')
      buffer = buffer.slice(gt + 1);

      // Self-closing?
      const selfClose = tagHead.endsWith('/');
      // Closing tag?
      const isClosing = tagHead.startsWith('/');

      if (isClosing) {
        // We encountered a closing tag without matching open in our simplified model.
        // Treat as "non-parsable" inline and skip emitting a tag; merely collapse it (remove).
        // Next loop iteration will continue after closing tag.
        prevEmittedWasTag = true;
        continue;
      }

      // Extract name + attrs from the tag head
      // Examples:
      //  a
      //  b attr="value"
      //  c attr="value" /
      const nameMatch = /^([A-Za-z_:][\w:.-]*)([\s\S]*)$/.exec(
        selfClose ? tagHead.slice(0, -1).trimEnd() : tagHead
      );
      if (!nameMatch) {
        // Not a valid tag name; treat it as text (fallback)
        // Since we already consumed up to '>', just pretend it wasn't a tag.
        // We drop the invalid tag and continue processing
        prevEmittedWasTag = true;
        continue;
      }

      const tagName = nameMatch[1];
      const rawAttrs = nameMatch[2]?.trim() ?? '';
      const attributes = parseAttributes(rawAttrs);

      if (selfClose) {
        // <c ... />
        tagsSubj.next({ name: tagName, attributes });
        prevEmittedWasTag = true;
        continue;
      }

      // Opening tag: look for the closing </name>
      const closeSeq = `</${tagName}>`;
      const closeIdx = buffer.indexOf(closeSeq);
      if (closeIdx === -1) {
        // Not complete yet; we need to wait for more data.
        // Rebuild the buffer to include the opening tag again so we can
        // try again later (we already removed it).
        buffer = `<${tagHead}>${buffer}`; // put it back
        return;
      }

      // We have a complete pair <name ...> ... </name>
      const inner = buffer.slice(0, closeIdx);
      // Consume closing tag
      buffer = buffer.slice(closeIdx + closeSeq.length);
      tagsSubj.next({ name: tagName, content: inner, attributes });
      prevEmittedWasTag = true;

      // Loop continues to find more tags/content in the remaining buffer
    }
  };

  const subscription = source.subscribe({
    next: (chunk) => {
      buffer += chunk;
      flushParsable();

      // If after parsing there’s no tag in buffer, we can safely emit the remainder as content.
      // BUT we delay right-trim until we know if a tag follows; here, since no '<' remains,
      // we can emit the whole thing (left-trim only if previous was a tag).
      const nextLt = buffer.indexOf('<');
      if (nextLt === -1 && buffer.length) {
        let out = buffer;
        if (prevEmittedWasTag) out = out.replace(/^\s+/, '');
        // Do not right-trim here; there is no upcoming tag boundary.
        if (out.length) contentSubj.next(out);
        buffer = '';
        prevEmittedWasTag = false;
      }
    },
    error: (err) => {
      try {
        contentSubj.error(err);
      } finally {
        tagsSubj.error(err);
      }
    },
    complete: () => {
      // At completion, if buffer contains anything, emit it as trailing content.
      if (buffer.length) {
        let out = buffer;
        if (prevEmittedWasTag) out = out.replace(/^\s+/, '');
        if (out.length) contentSubj.next(out);
        buffer = '';
      }
      contentSubj.complete();
      tagsSubj.complete();
    },
  });

  // Ensure upstream is torn down if both downstreams unsubscribe
  const finalize = () => subscription.unsubscribe();
  contentSubj.subscribe({ complete: finalize, error: finalize });
  tagsSubj.subscribe({ complete: finalize, error: finalize });

  return { content: contentSubj.asObservable(), tags: tagsSubj.asObservable() };
};
