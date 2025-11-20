/**
 * MCP Tool Provider
 *
 * Connects to an MCP server to provide tools via a standard protocol.
 *
 * Design Reference: design/tool-integration.md#mcp-tool-provider
 */

import type { AuthContext, ExecutionContext } from '../types/context';
import type { ToolCall, ToolDefinition, ToolProvider, ToolResult } from '../types/tools';
import { MCPClient, type MCPTool } from './mcp-client';

export interface MCPProviderConfig {
  serverId: string;
  serverUrl: string;
  timeout?: number;
  getHeaders: (authContext?: AuthContext) => Record<string, string>;
}

export const mcp = (config: MCPProviderConfig): McpToolProvider => {
  return new McpToolProvider(config);
};

export class McpToolProvider implements ToolProvider {
  name = 'mcp-tool-provider';

  readonly id: string;
  private readonly client: MCPClient;
  private toolCache = new Map<string, ToolDefinition>();
  private cacheExpiry: number | null = null;
  private readonly cacheTTL: number = 300_000; // 5 minutes
  private ongoingRequest: Promise<ToolDefinition[]> | null = null;

  constructor(config: MCPProviderConfig) {
    this.id = `mcp:${config.serverId}`;
    this.client = new MCPClient({
      baseUrl: config.serverUrl,
      timeout: config.timeout || 30000,
      getHeaders: config.getHeaders,
    });
  }

  async getTool(toolName: string): Promise<ToolDefinition | undefined> {
    const tools = await this.getTools();
    return tools.find((tool) => tool.name === toolName);
  }

  async executeBatch(toolCalls: ToolCall[], context: ExecutionContext): Promise<ToolResult[]> {
    return Promise.all(toolCalls.map((call) => this.execute(call, context)));
  }

  async getTools(): Promise<ToolDefinition[]> {
    if (this.toolCache.size > 0 && this.cacheExpiry && Date.now() < this.cacheExpiry) {
      return Array.from(this.toolCache.values());
    }

    if (this.ongoingRequest) {
      return this.ongoingRequest;
    }

    this.ongoingRequest = this.client
      .listTools()
      .then((tools) => {
        const toolDefs = tools.map(this.convertMCPTool);
        this.toolCache.clear();
        for (const tool of toolDefs) {
          this.toolCache.set(tool.name, tool);
        }
        this.cacheExpiry = Date.now() + this.cacheTTL;
        return toolDefs;
      })
      .finally(() => {
        this.ongoingRequest = null;
      });

    return this.ongoingRequest;
  }

  async execute(toolCall: ToolCall, context: ExecutionContext): Promise<ToolResult> {
    const { name, arguments: args } = toolCall.function;

    if (typeof args !== 'object' || args === null) {
      return {
        toolCallId: toolCall.id,
        toolName: name,
        success: false,
        error: 'Tool arguments must be an object',
        result: null,
      };
    }

    try {
      const response = await this.client.callTool(
        {
          name,
          arguments: args,
        },
        context.authContext,
      );

      return {
        toolCallId: toolCall.id,
        toolName: name,
        success: true,
        result: response.result,
      };
    } catch (error) {
      return {
        toolCallId: toolCall.id,
        toolName: name,
        success: false,
        error: error instanceof Error ? error.message : String(error),
        result: null,
      };
    }
  }

  private convertMCPTool = (mcpTool: MCPTool): ToolDefinition => {
    return {
      name: mcpTool.name,
      description: mcpTool.description,
      parameters: mcpTool.inputSchema,
    };
  };
}
