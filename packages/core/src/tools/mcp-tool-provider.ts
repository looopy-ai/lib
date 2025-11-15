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
  auth?: {
    type: 'bearer';
    token: string;
  };
  timeout?: number;
  authContextTransform?: (authContext: AuthContext) => AuthContext;
}

export class McpToolProvider implements ToolProvider {
  readonly id: string;
  private readonly client: MCPClient;
  private readonly authContextTransform?: (authContext: AuthContext) => AuthContext;
  private toolCache = new Map<string, ToolDefinition>();
  private cacheExpiry: number | null = null;
  private readonly cacheTTL: number = 60000; // 1 minute
  private ongoingRequest: Promise<ToolDefinition[]> | null = null;

  constructor(config: MCPProviderConfig) {
    this.id = `mcp:${config.serverId}`;
    this.client = new MCPClient({
      baseUrl: config.serverUrl,
      auth: config.auth,
      timeout: config.timeout || 30000,
    });
    this.authContextTransform = config.authContextTransform;
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

  canHandle(toolName: string): boolean {
    return this.toolCache.has(toolName);
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
      const authContext = this.authContextTransform
        ? this.authContextTransform(context.authContext)
        : context.authContext;

      const response = await this.client.callTool(
        {
          name,
          arguments: args,
        },
        authContext,
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
