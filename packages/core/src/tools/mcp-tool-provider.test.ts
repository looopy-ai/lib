/**
 * Tests for MCPToolProvider and MCPClient
 *
 * Mocks fetch to test without a live server.
 */

import { context } from '@opentelemetry/api';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExecutionContext } from '../types/context';
import type { ToolCall } from '../types/tools';
import type { MCPTool } from './mcp-client';
import { McpToolProvider } from './mcp-tool-provider';

// Mock the global fetch function
const mockFetch = vi.fn();
global.fetch = mockFetch;

const MOCK_TOOL_DEFS: MCPTool[] = [
  {
    name: 'file_read',
    description: 'Read a file',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
      },
      required: ['path'],
    },
  },
  {
    name: 'file_write',
    description: 'Write to a file',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        content: { type: 'string' },
      },
      required: ['path', 'content'],
    },
  },
];

const createOkResponse = (body: unknown) =>
  Promise.resolve(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  );

const createErrorResponse = (status: number, message: string) =>
  Promise.resolve(
    new Response(message, {
      status,
      statusText: message,
    }),
  );

describe('McpToolProvider', () => {
  let provider: McpToolProvider;
  const mockContext: ExecutionContext = {
    agentId: 'test-agent',
    contextId: 'test-context',
    taskId: 'test-task',
    authContext: {
      userId: 'test-token',
      credentials: { accessToken: 'test-token' },
    },
    parentContext: context.active(),
  };

  beforeEach(() => {
    mockFetch.mockClear();
    provider = new McpToolProvider({
      serverId: 'test-server',
      serverUrl: 'http://localhost:3100',
      getHeaders: (authContext) => ({
        Authorization: `Bearer ${authContext?.credentials?.accessToken || ''}`,
      }),
    });
  });

  it('should fetch and cache tools', async () => {
    // Mock the response for listTools
    mockFetch.mockReturnValueOnce(
      createOkResponse({
        jsonrpc: '2.0',
        id: '1',
        result: { tools: MOCK_TOOL_DEFS },
      }),
    );

    const tools = await provider.getTools();
    expect(tools).toHaveLength(2);
    expect(tools[0].name).toBe('file_read');
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith('http://localhost:3100/rpc', expect.any(Object));

    // Should use cache for the second call
    const cachedTools = await provider.getTools();
    expect(cachedTools).toEqual(tools);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('should execute a tool successfully', async () => {
    // Need to populate the cache first
    mockFetch.mockReturnValueOnce(
      createOkResponse({
        jsonrpc: '2.0',
        id: '1',
        result: { tools: MOCK_TOOL_DEFS },
      }),
    );
    await provider.getTools();

    // Mock the response for callTool
    mockFetch.mockReturnValueOnce(
      createOkResponse({
        jsonrpc: '2.0',
        id: '2',
        result: { result: 'file content', executionTime: 100 },
      }),
    );

    const toolCall: ToolCall = {
      id: 'call1',
      type: 'function',
      function: {
        name: 'file_read',
        arguments: { path: '/test.txt' },
      },
    };

    const result = await provider.execute(toolCall, mockContext);

    expect(result.success).toBe(true);
    expect(result.result).toBe('file content');
    expect(result.toolName).toBe('file_read');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('should handle tool execution errors from the server', async () => {
    mockFetch.mockReturnValueOnce(
      createOkResponse({
        jsonrpc: '2.0',
        id: '1',
        result: { tools: MOCK_TOOL_DEFS },
      }),
    );
    await provider.getTools();

    mockFetch.mockReturnValueOnce(
      createOkResponse({
        jsonrpc: '2.0',
        id: '2',
        error: { code: -32000, message: 'File not found' },
      }),
    );

    const toolCall: ToolCall = {
      id: 'call2',
      type: 'function',
      function: {
        name: 'file_read',
        arguments: { path: '/nonexistent.txt' },
      },
    };

    const result = await provider.execute(toolCall, mockContext);

    expect(result.success).toBe(false);
    expect(result.error).toContain('File not found');
  });

  it('should handle network errors gracefully', async () => {
    mockFetch.mockReturnValueOnce(createErrorResponse(500, 'Internal Server Error'));

    await expect(provider.getTools()).rejects.toThrow('MCP request failed with status 500');
  });

  it('should handle timeouts', async () => {
    provider = new McpToolProvider({
      serverId: 'test-server',
      serverUrl: 'http://localhost:3100',
      timeout: 100,
      getHeaders: (authContext) => ({
        Authorization: `Bearer ${authContext?.credentials?.accessToken || ''}`,
      }),
    });

    mockFetch.mockImplementation((_url, options) => {
      return new Promise((resolve, reject) => {
        const signal = options?.signal as AbortSignal;
        const timeout = setTimeout(() => {
          resolve(createOkResponse({ jsonrpc: '2.0', id: '1', result: {} }));
        }, 200);

        if (signal) {
          signal.addEventListener('abort', () => {
            clearTimeout(timeout);
            const error = new Error('The user aborted a request.');
            error.name = 'AbortError';
            reject(error);
          });
        }
      });
    });

    await expect(provider.getTools()).rejects.toThrow('MCP request timed out after 100ms');
  });

  it('should return tool definition via getTool', async () => {
    mockFetch.mockReturnValueOnce(
      createOkResponse({
        jsonrpc: '2.0',
        id: '1',
        result: { tools: MOCK_TOOL_DEFS },
      }),
    );

    const tool = await provider.getTool('file_read');
    expect(tool?.name).toBe('file_read');
  });

  it('should return undefined for unknown tools', async () => {
    mockFetch.mockReturnValueOnce(
      createOkResponse({
        jsonrpc: '2.0',
        id: '1',
        result: { tools: MOCK_TOOL_DEFS },
      }),
    );

    const tool = await provider.getTool('non_existent_tool');
    expect(tool).toBeUndefined();
  });

  it('should use authContext from context', async () => {
    mockFetch.mockReturnValue(
      createOkResponse({
        jsonrpc: '2.0',
        id: '1',
        result: { result: 'ok' },
      }),
    );

    const toolCall: ToolCall = {
      id: 'call1',
      type: 'function',
      function: {
        name: 'file_read',
        arguments: { path: '/test.txt' },
      },
    };

    await provider.execute(toolCall, mockContext);

    const fetchOptions = mockFetch.mock.calls[0][1] as RequestInit;
    expect(fetchOptions.headers).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer test-token',
    });
  });

  it('should use authContextTransform when provided', async () => {
    provider = new McpToolProvider({
      serverId: 'test-server',
      serverUrl: 'http://localhost:3100',
      getHeaders: (authContext) => ({
        Authorization: `Bearer ${authContext?.userId || ''}`,
      }),
    });

    mockFetch.mockReturnValue(
      createOkResponse({
        jsonrpc: '2.0',
        id: '1',
        result: { result: 'ok' },
      }),
    );

    const toolCall: ToolCall = {
      id: 'call1',
      type: 'function',
      function: {
        name: 'file_read',
        arguments: { path: '/test.txt' },
      },
    };

    await provider.execute(toolCall, mockContext);

    const fetchOptions = mockFetch.mock.calls[0][1] as RequestInit;
    expect(fetchOptions.headers).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer test-token',
    });
  });
});
