import { describe, expect, it } from 'vitest';
import { renderToolResult } from '../src/formatting/result-shaper.js';

describe('renderToolResult', () => {
  it('prefers text content in content mode', () => {
    const result = renderToolResult({
      content: [
        { type: 'text', text: 'first line' },
        { type: 'text', text: 'second line' },
      ],
      structuredContent: { ignored: true },
    }, {
      maxCharacters: 1_000,
    });

    expect(result.outputMode).toBe('content');
    expect(result.text).toBe('first line\n\nsecond line');
    expect(result.truncated).toBe(false);
  });

  it('projects and limits structured output', () => {
    const result = renderToolResult({
      structuredContent: {
        items: [
          { id: 'item-1', value: 1 },
          { id: 'item-2', value: 2 },
          { id: 'item-3', value: 3 },
        ],
      },
    }, {
      maxCharacters: 1_000,
      outputMode: 'structured',
      fieldPath: 'items',
      maxArrayItems: 2,
    });

    expect(Array.isArray(result.selectedValue)).toBe(true);
    expect((result.selectedValue as Array<{ id: string }>)).toHaveLength(2);
    expect(result.text).toContain('item-1');
    expect(result.text).toContain('item-2');
    expect(result.text).not.toContain('item-3');
  });

  it('falls back to the full result when content mode has no text blocks', () => {
    const result = renderToolResult({
      structuredContent: {
        summary: {
          total: 2,
        },
      },
    }, {
      maxCharacters: 1_000,
      outputMode: 'content',
    });

    expect(result.text).toContain('"total": 2');
  });

  it('truncates oversized payloads', () => {
    const result = renderToolResult({
      content: [{ type: 'text', text: 'abcdefghijklmnopqrstuvwxyz' }],
    }, {
      maxCharacters: 10,
    });

    expect(result.truncated).toBe(true);
    expect(result.text).toContain('[truncated');
  });
});
