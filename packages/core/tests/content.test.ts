/**
 * Tests for content operators - splitInlineXml
 */

import { lastValueFrom, Subject, toArray } from 'rxjs';
import { describe, expect, it } from 'vitest';
import { splitInlineXml } from '../src/providers/chat-completions/content';

/**
 * Helper function to test splitInlineXml with chunks
 */
async function testSplit(chunks: string[]) {
  const source = new Subject<string>();
  const result = splitInlineXml(source.asObservable());

  const contentPromise = lastValueFrom(result.content.pipe(toArray()));
  const tagsPromise = lastValueFrom(result.tags.pipe(toArray()));

  for (const chunk of chunks) {
    source.next(chunk);
  }
  source.complete();

  const [content, tags] = await Promise.all([contentPromise, tagsPromise]);
  return { content, tags };
}

describe('splitInlineXml', () => {
  describe('basic tag parsing', () => {
    it('should extract self-closing tag', async () => {
      const { content, tags } = await testSplit(['Hello', '<tag />', 'World']);

      expect(content).toEqual(['Hello', 'World']);
      expect(tags).toHaveLength(1);
      expect(tags[0]).toEqual({
        name: 'tag',
        attributes: {},
      });
    });

    it('should extract paired tags with content', async () => {
      const { content, tags } = await testSplit(['Hello <tag attr="value">inner text</tag> World']);

      expect(content).toEqual(['Hello', 'World']);
      expect(tags).toHaveLength(1);
      expect(tags[0]).toEqual({
        name: 'tag',
        content: 'inner text',
        attributes: { attr: 'value' },
      });
    });

    it('should handle tags with no attributes', async () => {
      const { content, tags } = await testSplit(['<simple>content</simple>']);

      expect(content).toEqual([]);
      expect(tags).toHaveLength(1);
      expect(tags[0]).toEqual({
        name: 'simple',
        content: 'content',
        attributes: {},
      });
    });

    it('should handle self-closing tag with no attributes', async () => {
      const { content, tags } = await testSplit(['<br/>']);

      expect(content).toEqual([]);
      expect(tags).toHaveLength(1);
      expect(tags[0]).toEqual({
        name: 'br',
        attributes: {},
      });
    });

    it('should handle multiple attributes', async () => {
      const { tags } = await testSplit(['<tag a="1" b="2" c="3"/>']);

      expect(tags[0].attributes).toEqual({ a: '1', b: '2', c: '3' });
    });

    it('should handle multiple attributes, following space', async () => {
      const { tags } = await testSplit(['<tag a="1" b="2" c="3" />']);

      expect(tags[0].attributes).toEqual({ a: '1', b: '2', c: '3' });
    });

    it('should handle duplicate attribute names as array', async () => {
      const { tags } = await testSplit(['<tag class="foo" class="bar"/>']);

      expect(tags[0].attributes).toEqual({ class: ['foo', 'bar'] });
    });
  });

  describe('tags broken across chunks', () => {
    it('should handle tag opening split across chunks', async () => {
      const { content, tags } = await testSplit(['Hello <ta', 'g attr="val"/> World']);

      expect(content).toEqual(['Hello', 'World']);
      expect(tags).toHaveLength(1);
      expect(tags[0].name).toBe('tag');
    });

    it('should handle tag name split across chunks', async () => {
      const { tags } = await testSplit(['<ta', 'gname>content</tagname>']);

      expect(tags).toHaveLength(1);
      expect(tags[0].name).toBe('tagname');
      expect(tags[0].content).toBe('content');
    });

    it('should handle attributes split across chunks', async () => {
      const { tags } = await testSplit(['<tag attr="va', 'lue"/>']);

      expect(tags[0].attributes).toEqual({ attr: 'value' });
    });

    it('should handle closing bracket split', async () => {
      const { tags } = await testSplit(['<tag/', '>']);

      expect(tags).toHaveLength(1);
      expect(tags[0].name).toBe('tag');
    });

    it('should handle paired tag with closing tag split', async () => {
      const { tags } = await testSplit(['<tag>content</ta', 'g>']);

      expect(tags).toHaveLength(1);
      expect(tags[0].content).toBe('content');
    });

    it('should handle tag content split across chunks', async () => {
      const { tags } = await testSplit(['<tag>cont', 'ent</tag>']);

      expect(tags[0].content).toBe('content');
    });

    it('should handle entire tag split across many chunks', async () => {
      const { tags } = await testSplit([
        '<',
        't',
        'a',
        'g',
        ' ',
        'a',
        '=',
        '"',
        '1',
        '"',
        '/',
        '>',
      ]);

      expect(tags).toHaveLength(1);
      expect(tags[0].name).toBe('tag');
      expect(tags[0].attributes).toEqual({ a: '1' });
    });

    it('should handle paired tag split across many chunks', async () => {
      const { tags } = await testSplit(['<', 'tag', '>', 'con', 'tent', '</', 'tag', '>']);

      expect(tags).toHaveLength(1);
      expect(tags[0].content).toBe('content');
    });
  });

  describe('whitespace handling - tags with only whitespace between them', () => {
    it('should trim whitespace between consecutive tags', async () => {
      const { content, tags } = await testSplit(['<tag1/>   <tag2/>']);

      expect(content).toEqual([]);
      expect(tags).toHaveLength(2);
    });

    it('should trim whitespace between paired tags', async () => {
      const { content, tags } = await testSplit(['<tag1>content</tag1>   <tag2>more</tag2>']);

      expect(content).toEqual([]);
      expect(tags).toHaveLength(2);
      expect(tags[0].content).toBe('content');
      expect(tags[1].content).toBe('more');
    });

    it('should trim whitespace including newlines and tabs', async () => {
      const { content, tags } = await testSplit(['<tag1/>\n\t\r\n  <tag2/>']);

      expect(content).toEqual([]);
      expect(tags).toHaveLength(2);
    });

    it('should trim whitespace before first tag', async () => {
      const { content } = await testSplit(['   <tag/>']);

      expect(content).toEqual([]);
    });

    it('should not trim whitespace after last tag (no following tag)', async () => {
      const { content } = await testSplit(['<tag/>', '   ']);

      // Trailing whitespace at end of stream is trimmed
      expect(content).toEqual([]);
    });

    it('should trim whitespace split across chunks between tags', async () => {
      const { content, tags } = await testSplit(['<tag1/>', '   ', '<tag2/>']);

      expect(content).toEqual([]);
      expect(tags).toHaveLength(2);
    });
  });

  describe('whitespace handling - tags with whitespace after but before content', () => {
    it('should trim whitespace after tag before content', async () => {
      const { content } = await testSplit(['<tag/>   content']);

      expect(content).toEqual(['content']);
    });

    it('should trim whitespace after paired tag before content', async () => {
      const { content } = await testSplit(['<tag>inner</tag>   content']);

      expect(content).toEqual(['content']);
    });

    it('should trim whitespace before tag after content', async () => {
      const { content } = await testSplit(['content   <tag/>']);

      expect(content).toEqual(['content']);
    });

    it('should handle whitespace after tag at chunk boundary', async () => {
      const { content } = await testSplit(['<tag/>', '   ', 'content']);

      expect(content).toEqual(['content']);
    });

    it('should handle whitespace before tag at chunk boundary', async () => {
      const { content } = await testSplit(['content', '   ', '<tag/>']);

      // Whitespace before tag is emitted as separate chunk, then trimmed
      expect(content).toEqual(['content', '   ']);
    });
  });

  describe('preserve whitespace in content (not at tag boundaries)', () => {
    it('should preserve spaces within content', async () => {
      const { content } = await testSplit(['Hello   World']);

      expect(content).toEqual(['Hello   World']);
    });

    it('should preserve newlines within content', async () => {
      const { content } = await testSplit(['Line 1\nLine 2\nLine 3']);

      expect(content).toEqual(['Line 1\nLine 2\nLine 3']);
    });

    it('should preserve indentation within content', async () => {
      const { content } = await testSplit(['  indented\n    more indented']);

      expect(content).toEqual(['  indented\n    more indented']);
    });

    it('should preserve whitespace around content between tags', async () => {
      const { content } = await testSplit(['content  with  spaces']);

      expect(content).toEqual(['content  with  spaces']);
    });

    it('should preserve whitespace inside paired tag content', async () => {
      const { tags } = await testSplit(['<tag>  inner  content  with  spaces  </tag>']);

      expect(tags[0].content).toBe('  inner  content  with  spaces  ');
    });

    it('should preserve mixed whitespace in content chunks', async () => {
      const { content } = await testSplit([
        'Hello\t\ttabs\n\nNewlines   Spaces',
        '<tag/>',
        'More  content',
      ]);

      expect(content).toEqual(['Hello\t\ttabs\n\nNewlines   Spaces', 'More  content']);
    });

    it('should preserve whitespace when content is split across chunks', async () => {
      const { content } = await testSplit(['Hello ', '   World']);

      // Streaming operator emits chunks as they arrive without concatenating
      expect(content).toEqual(['Hello ', '   World']);
    });

    it('should preserve whitespace between content and tag in middle', async () => {
      const { content } = await testSplit(['Start  content', '<tag/>', 'more  content  End']);

      expect(content).toEqual(['Start  content', 'more  content  End']);
    });
  });

  describe('multiple tags', () => {
    it('should handle multiple self-closing tags', async () => {
      const { tags } = await testSplit(['<tag1/><tag2/><tag3/>']);

      expect(tags).toHaveLength(3);
      expect(tags.map((t) => t.name)).toEqual(['tag1', 'tag2', 'tag3']);
    });

    it('should handle multiple paired tags', async () => {
      const { tags } = await testSplit(['<tag1>1</tag1><tag2>2</tag2><tag3>3</tag3>']);

      expect(tags).toHaveLength(3);
      expect(tags[0].content).toBe('1');
      expect(tags[1].content).toBe('2');
      expect(tags[2].content).toBe('3');
    });

    it('should handle mixed self-closing and paired tags', async () => {
      const { tags } = await testSplit(['<tag1>content</tag1><tag2/><tag3/>']);

      expect(tags).toHaveLength(3);
      expect(tags[0].content).toBe('content');
      expect(tags[1]).not.toHaveProperty('content');
      expect(tags[2]).not.toHaveProperty('content');
    });

    it('should handle tags with content between them', async () => {
      const { content, tags } = await testSplit(['Text1<tag1/>Text2<tag2/>Text3']);

      expect(content).toEqual(['Text1', 'Text2', 'Text3']);
      expect(tags).toHaveLength(2);
    });
  });

  describe('edge cases', () => {
    it('should handle stream with no tags', async () => {
      const { content, tags } = await testSplit(['Just plain text']);

      expect(content).toEqual(['Just plain text']);
      expect(tags).toEqual([]);
    });

    it('should handle stream with only tags', async () => {
      const { content, tags } = await testSplit(['<tag1/><tag2/><tag3/>']);

      expect(content).toEqual([]);
      expect(tags).toHaveLength(3);
    });

    it('should handle orphaned closing tag', async () => {
      const { content, tags } = await testSplit(['</tag>content']);

      expect(content).toEqual(['content']);
      expect(tags).toEqual([]);
    });

    it('should handle incomplete paired tag at end of stream', async () => {
      const { content, tags } = await testSplit(['<tag>incomplete']);

      // Tag not closed, so treated as content at completion
      expect(content).toEqual(['<tag>incomplete']);
      expect(tags).toEqual([]);
    });

    it('should handle incomplete self-closing tag at end of stream', async () => {
      const { content, tags } = await testSplit(['<tag']);

      // Incomplete tag, treated as content
      expect(content).toEqual(['<tag']);
      expect(tags).toEqual([]);
    });

    it('should handle tag-like content with no closing bracket', async () => {
      const { content } = await testSplit(['<tag without closing']);

      expect(content).toEqual(['<tag without closing']);
    });

    it('should handle empty tag content', async () => {
      const { tags } = await testSplit(['<tag></tag>']);

      expect(tags).toHaveLength(1);
      expect(tags[0].content).toBe('');
    });

    it('should handle single character chunks', async () => {
      const { content, tags } = await testSplit([
        '<',
        't',
        'a',
        'g',
        '1',
        '/',
        '>',
        'a',
        '<',
        't',
        'a',
        'g',
        '2',
        '/',
        '>',
      ]);

      expect(content).toEqual(['a']);
      expect(tags).toHaveLength(2);
    });

    it('should handle empty chunks', async () => {
      const { content, tags } = await testSplit(['Hello', '', '<tag/>', '', 'World', '']);

      expect(content).toEqual(['Hello', 'World']);
      expect(tags).toHaveLength(1);
    });

    it('should handle very long tag names', async () => {
      const longName = 'a'.repeat(1000);
      const { tags } = await testSplit([`<${longName}/>`]);

      expect(tags).toHaveLength(1);
      expect(tags[0].name).toBe(longName);
    });

    it('should handle very long attribute values', async () => {
      const longValue = 'x'.repeat(1000);
      const { tags } = await testSplit([`<tag attr="${longValue}"/>`]);

      expect(tags[0].attributes).toEqual({ attr: longValue });
    });
  });

  describe('complex real-world scenarios', () => {
    it('should handle streaming LLM response with thought tags', async () => {
      const { content, tags } = await testSplit([
        'Let me think ',
        'about this.',
        '<thought>Analyzing...</thought>',
        ' The answer is 42.',
      ]);

      expect(content.join('')).toBe('Let me think about this.The answer is 42.');
      expect(tags).toHaveLength(1);
      expect(tags[0].name).toBe('thought');
      expect(tags[0].content).toBe('Analyzing...');
    });

    it('should handle multiple thoughts interspersed with content', async () => {
      const { content, tags } = await testSplit([
        'First',
        '<thought>hmm</thought>',
        'then',
        '<thought>aha</thought>',
        'finally.',
      ]);

      expect(content).toEqual(['First', 'then', 'finally.']);
      expect(tags).toHaveLength(2);
      expect(tags[0].content).toBe('hmm');
      expect(tags[1].content).toBe('aha');
    });

    it('should preserve code formatting in content', async () => {
      const { content } = await testSplit(['```\nfunction test() {\n  return 42;\n}\n```']);

      expect(content[0]).toContain('```');
      expect(content[0]).toContain('  return 42;');
    });

    it('should handle tag with complex attributes', async () => {
      const { tags } = await testSplit([
        '<thought confidence="high" type="analysis" step="1">reasoning</thought>',
      ]);

      expect(tags[0].attributes).toEqual({
        confidence: 'high',
        type: 'analysis',
        step: '1',
      });
    });

    it('should handle very long content between tags', async () => {
      const longContent = 'x'.repeat(10000);
      const { content } = await testSplit(['<tag/>', longContent, '<tag/>']);

      expect(content).toEqual([longContent]);
    });

    it('should handle rapidly alternating tags and content', async () => {
      const { content, tags } = await testSplit([
        'a',
        '<t1/>',
        'b',
        '<t2/>',
        'c',
        '<t3/>',
        'd',
        '<t4/>',
        'e',
      ]);

      expect(content).toEqual(['a', 'b', 'c', 'd', 'e']);
      expect(tags).toHaveLength(4);
    });

    it('should handle tags with unusual but valid names', async () => {
      const { tags } = await testSplit(['<my-tag/>', '<my_tag/>', '<my.tag/>', '<my:tag/>']);

      expect(tags).toHaveLength(4);
      expect(tags.map((t) => t.name)).toEqual(['my-tag', 'my_tag', 'my.tag', 'my:tag']);
    });
  });

  describe('whitespace preservation combinations', () => {
    it('should trim at tag boundary but preserve internal spaces', async () => {
      const { content } = await testSplit([
        '   <tag/>   ',
        'content  with  spaces',
        '   <tag/>   ',
        'more  spaces  ',
      ]);

      // Left trim before first tag boundary, right trim at tag boundary
      expect(content).toEqual(['content  with  spaces', 'more  spaces  ']);
    });

    it('should handle tabs and newlines at boundaries vs internal', async () => {
      const { content } = await testSplit([
        '\t\n<tag/>\t\nstart\t\ncontent\t\n',
        '<tag/>\t\nmore\t\ncontent\t\n',
      ]);

      // Trim whitespace after tag
      // Preserve trailing whitespace (no tag after)
      expect(content[0]).toBe('start\t\ncontent\t\n');
      expect(content[1]).toBe('more\t\ncontent\t\n');
    });

    it('should preserve paragraph structure with tags', async () => {
      const { content } = await testSplit([
        'Paragraph 1.\n\n',
        '<thought>thinking</thought>',
        'Paragraph 2.',
      ]);

      expect(content[0]).toBe('Paragraph 1.\n\n');
      expect(content[1]).toBe('Paragraph 2.');
    });

    it('should handle whitespace with tags split across many chunks', async () => {
      const { content } = await testSplit([
        '  ',
        ' ',
        '<',
        'tag',
        '/',
        '>',
        '  ',
        ' ',
        'content',
        '  ',
        ' ',
        '<',
        'tag',
        '/',
        '>',
        '  ',
        ' ',
        'more',
      ]);

      // Whitespace chunks are emitted as they arrive
      expect(content).toEqual(['  ', ' ', ' ', 'content', '  ', ' ', ' ', 'more']);
    });

    it('should preserve exact whitespace when no tags present', async () => {
      const { content } = await testSplit(['  \n\t  content  \n\t  ']);

      expect(content).toEqual(['  \n\t  content  \n\t  ']);
    });
  });
});
