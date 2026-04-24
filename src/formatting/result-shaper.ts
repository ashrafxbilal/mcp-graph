import { safeJsonStringify, truncateText } from '../utils.js';

export interface GraphToolResult {
  isError?: boolean;
  content?: Array<{ type?: string; text?: string; [key: string]: unknown }>;
  structuredContent?: unknown;
  [key: string]: unknown;
}

export interface RenderToolResultOptions {
  maxCharacters: number;
  outputMode?: 'content' | 'structured' | 'full';
  fieldPath?: string;
  maxArrayItems?: number;
}

export interface RenderToolResultOutput {
  text: string;
  truncated: boolean;
  selectedValue: unknown;
  outputMode: 'content' | 'structured' | 'full';
}

export function renderToolResult(result: GraphToolResult, options: RenderToolResultOptions): RenderToolResultOutput {
  const outputMode = options.outputMode ?? 'content';
  const projectedValue = projectValue(selectBaseValue(result, outputMode), options.fieldPath, options.maxArrayItems ?? 50);
  const rendered = renderSelectedValue(projectedValue, outputMode, result);
  const { text, truncated } = truncateText(rendered, options.maxCharacters);
  return {
    text,
    truncated,
    selectedValue: projectedValue,
    outputMode,
  };
}

function selectBaseValue(result: GraphToolResult, outputMode: 'content' | 'structured' | 'full'): unknown {
  if (outputMode === 'full') {
    return result;
  }
  if (outputMode === 'structured') {
    return result.structuredContent ?? result;
  }

  const textParts = (result.content ?? [])
    .filter((entry) => entry.type === 'text' && typeof entry.text === 'string')
    .map((entry) => entry.text as string);

  if (textParts.length > 0) {
    return textParts.join('\n\n');
  }

  return result.structuredContent ?? result;
}

function renderSelectedValue(value: unknown, outputMode: 'content' | 'structured' | 'full', result: GraphToolResult): string {
  if (typeof value === 'string') {
    return value;
  }
  if (value === undefined) {
    if (outputMode === 'content') {
      return safeJsonStringify(result, 2);
    }
    return 'null';
  }
  return safeJsonStringify(value, 2);
}

function projectValue(value: unknown, fieldPath: string | undefined, maxArrayItems: number): unknown {
  const selected = fieldPath ? getByPath(value, fieldPath) : value;
  return limitArrays(selected, maxArrayItems);
}

function getByPath(value: unknown, fieldPath: string): unknown {
  const tokens = fieldPath
    .split('.')
    .map((token) => token.trim())
    .filter(Boolean);

  let current = value;
  for (const token of tokens) {
    if (Array.isArray(current)) {
      const index = Number.parseInt(token, 10);
      if (!Number.isInteger(index)) {
        return undefined;
      }
      current = current[index];
      continue;
    }
    if (current && typeof current === 'object') {
      current = (current as Record<string, unknown>)[token];
      continue;
    }
    return undefined;
  }
  return current;
}

function limitArrays(value: unknown, maxArrayItems: number): unknown {
  if (Array.isArray(value)) {
    return value.slice(0, maxArrayItems).map((entry) => limitArrays(entry, maxArrayItems));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, limitArrays(entry, maxArrayItems)]),
    );
  }
  return value;
}
