/**
 * MCP Client
 *
 * Handles JSON-RPC communication with an MCP server.
 *
 * Design Reference: design/tool-integration.md#mcp-client
 */

import type { FunctionParameters } from '../types/tools';

/**
 * MCP tool definition from server
 */
export interface MCPTool {
  name: string;
  description: string;
  inputSchema: FunctionParameters;
  version?: string;
}

/**
 * MCP tool call response from server
 */
export interface MCPToolResponse {
  result: unknown;
  executionTime: number;
}

interface MCPRequest {
  method: string;
  params: unknown;
}

interface MCPError {
  code: number;
  message: string;
  data?: unknown;
}

interface MCPJSONRPCResponse<T> {
  jsonrpc: '2.0';
  id: string;
  result?: T;
  error?: MCPError;
}

export interface MCPClientConfig<AuthContext> {
  baseUrl: string;
  getHeaders: (authContext?: AuthContext) => Record<string, string>;
  timeout?: number;
}

// Simple ID generator for JSON-RPC
const generateId = () => Math.random().toString(36).substring(2);

export class MCPClient<AuthContext> {
  private readonly baseUrl: string;
  private readonly timeout: number;
  private readonly getHeaders: (authContext?: AuthContext) => Record<string, string>;

  constructor(config: MCPClientConfig<AuthContext>) {
    this.baseUrl = config.baseUrl;
    this.timeout = config.timeout || 30000;
    this.getHeaders = config.getHeaders;
  }

  async listTools(): Promise<MCPTool[]> {
    const response = await this.request<{ tools: MCPTool[] }>({
      method: 'tools/list',
      params: {},
    });
    return response.tools;
  }

  async callTool(
    params: {
      name: string;
      arguments: Record<string, unknown>;
    },
    authContext?: AuthContext,
  ): Promise<MCPToolResponse> {
    return await this.request<MCPToolResponse>(
      {
        method: 'tools/call',
        params,
      },
      authContext,
    );
  }

  private async request<T>(req: MCPRequest, authContext?: AuthContext): Promise<T> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(`${this.baseUrl}/rpc`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.getHeaders(authContext),
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: generateId(),
          ...req,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(
          `MCP request failed with status ${response.status}: ${response.statusText}`,
        );
      }

      const json = (await response.json()) as MCPJSONRPCResponse<T>;

      if (json.error) {
        throw new Error(`MCP error: ${json.error.message} (code: ${json.error.code})`);
      }

      if (json.result === undefined) {
        throw new Error('Invalid MCP response: missing result');
      }

      return json.result;
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`MCP request timed out after ${this.timeout}ms`);
      }
      throw error;
    }
  }
}
