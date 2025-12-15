# Dynamic Discovery

## Overview

Dynamic discovery enables Looopy to automatically find and integrate tools and agents at runtime without manual configuration. This allows for:

- **Elastic scaling**: Add/remove tool plugins as needed
- **Service mesh integration**: Discover services via service registry
- **Plugin systems**: Load tools from external packages
- **Multi-tenant isolation**: Per-tenant tool availability
- **A/B testing**: Route to different tool versions

> Note: Tool discovery now registers plugins (with `listTools`/`executeTool`) rather than a dedicated `toolProviders` array. The provider language below refers to these plugins.

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│              Service Registry                            │
│  • Consul / etcd / Kubernetes Service Discovery          │
│  • Tool metadata storage                                 │
│  • Health checks                                         │
└────────────────────────┬─────────────────────────────────┘
                         │
                         │ Watch for changes
                         │
┌────────────────────────▼─────────────────────────────────┐
│           Discovery Service                              │
│  ┌────────────────────────────────────────────────────┐  │
│  │  • Poll registry for services                      │  │
│  │  • Parse service metadata                          │  │
│  │  • Create provider instances                       │  │
│  │  • Register with tool router                       │  │
│  │  • Monitor health                                  │  │
│  └────────────────────────────────────────────────────┘  │
└────────────────────────┬─────────────────────────────────┘
                         │
                         │ Dynamic registration
                         │
┌────────────────────────▼─────────────────────────────────┐
│              Tool Router                                 │
│  • Maintains live tool registry                          │
│  • Routes calls to available providers                   │
│  • Handles provider failures                             │
└──────────────────────────────────────────────────────────┘
```

## Service Discovery

### Service Registry Interface

```typescript
interface ServiceRegistry {
  /**
   * Find services matching criteria
   */
  findServices(query: ServiceQuery): Observable<ServiceDescriptor[]>;

  /**
   * Watch for service changes
   */
  watchServices(query: ServiceQuery): Observable<ServiceEvent>;

  /**
   * Register a service
   */
  registerService(descriptor: ServiceDescriptor): Observable<void>;

  /**
   * Deregister a service
   */
  deregisterService(serviceId: string): Observable<void>;

  /**
   * Health check
   */
  healthCheck(serviceId: string): Observable<HealthStatus>;
}

interface ServiceDescriptor {
  id: string;
  name: string;
  type: 'mcp-server' | 'agent' | 'tool-provider';
  version: string;
  endpoint: string;
  metadata: {
    capabilities?: string[];
    tags?: string[];
    toolNames?: string[];
    auth?: {
      type: string;
      config?: Record<string, unknown>;
    };
  };
  health?: {
    status: 'healthy' | 'unhealthy' | 'unknown';
    lastCheck?: Date;
  };
}

interface ServiceQuery {
  type?: string;
  tags?: string[];
  capabilities?: string[];
  healthy?: boolean;
}

interface ServiceEvent {
  type: 'added' | 'removed' | 'updated';
  service: ServiceDescriptor;
  timestamp: Date;
}
```

### Consul Implementation

```typescript
import Consul from 'consul';

class ConsulServiceRegistry implements ServiceRegistry {
  private consul: Consul.Consul;

  constructor(config: { host: string; port: number }) {
    this.consul = new Consul(config);
  }

  findServices(query: ServiceQuery): Observable<ServiceDescriptor[]> {
    return from(
      this.consul.catalog.service.nodes({
        service: query.type || 'mcp-server'
      })
    ).pipe(
      map(result => result.map(this.convertConsulService)),
      map(services => this.filterServices(services, query))
    );
  }

  watchServices(query: ServiceQuery): Observable<ServiceEvent> {
    return new Observable(subscriber => {
      const watch = this.consul.watch({
        method: this.consul.catalog.service.nodes,
        options: {
          service: query.type || 'mcp-server'
        }
      });

      let previousServices = new Map<string, ServiceDescriptor>();

      watch.on('change', (data: unknown[]) => {
        const currentServices = new Map(
          (data as any[])
            .map(this.convertConsulService)
            .map(s => [s.id, s])
        );

        // Detect additions
        currentServices.forEach((service, id) => {
          if (!previousServices.has(id)) {
            subscriber.next({
              type: 'added',
              service,
              timestamp: new Date()
            });
          } else if (
            JSON.stringify(service) !== JSON.stringify(previousServices.get(id))
          ) {
            subscriber.next({
              type: 'updated',
              service,
              timestamp: new Date()
            });
          }
        });

        // Detect removals
        previousServices.forEach((service, id) => {
          if (!currentServices.has(id)) {
            subscriber.next({
              type: 'removed',
              service,
              timestamp: new Date()
            });
          }
        });

        previousServices = currentServices;
      });

      watch.on('error', (error: Error) => {
        subscriber.error(error);
      });

      return () => watch.end();
    });
  }

  registerService(descriptor: ServiceDescriptor): Observable<void> {
    return from(
      this.consul.agent.service.register({
        id: descriptor.id,
        name: descriptor.name,
        tags: [
          descriptor.type,
          ...(descriptor.metadata.tags || [])
        ],
        address: new URL(descriptor.endpoint).hostname,
        port: parseInt(new URL(descriptor.endpoint).port),
        meta: {
          version: descriptor.version,
          capabilities: JSON.stringify(descriptor.metadata.capabilities),
          toolNames: JSON.stringify(descriptor.metadata.toolNames)
        },
        check: {
          http: `${descriptor.endpoint}/health`,
          interval: '10s',
          timeout: '5s'
        }
      })
    ).pipe(map(() => void 0));
  }

  private convertConsulService(node: any): ServiceDescriptor {
    return {
      id: node.ServiceID,
      name: node.ServiceName,
      type: node.ServiceTags[0],
      version: node.ServiceMeta.version || '1.0.0',
      endpoint: `http://${node.ServiceAddress}:${node.ServicePort}`,
      metadata: {
        tags: node.ServiceTags.slice(1),
        capabilities: JSON.parse(node.ServiceMeta.capabilities || '[]'),
        toolNames: JSON.parse(node.ServiceMeta.toolNames || '[]')
      }
    };
  }

  private filterServices(
    services: ServiceDescriptor[],
    query: ServiceQuery
  ): ServiceDescriptor[] {
    return services.filter(service => {
      if (query.tags && !query.tags.every(t => service.metadata.tags?.includes(t))) {
        return false;
      }

      if (query.capabilities &&
          !query.capabilities.every(c => service.metadata.capabilities?.includes(c))) {
        return false;
      }

      if (query.healthy && service.health?.status !== 'healthy') {
        return false;
      }

      return true;
    });
  }
}
```

### Kubernetes Implementation

```typescript
import * as k8s from '@kubernetes/client-node';

class KubernetesServiceRegistry implements ServiceRegistry {
  private k8sApi: k8s.CoreV1Api;

  constructor() {
    const kc = new k8s.KubeConfig();
    kc.loadFromDefault();
    this.k8sApi = kc.makeApiClient(k8s.CoreV1Api);
  }

  findServices(query: ServiceQuery): Observable<ServiceDescriptor[]> {
    return from(
      this.k8sApi.listNamespacedService('default')
    ).pipe(
      map(response => response.body.items),
      map(services => services
        .filter(svc => svc.metadata?.labels?.['app.kubernetes.io/component'] === query.type)
        .map(this.convertK8sService)
      )
    );
  }

  watchServices(query: ServiceQuery): Observable<ServiceEvent> {
    return new Observable(subscriber => {
      const watch = new k8s.Watch(new k8s.KubeConfig());

      const req = watch.watch(
        '/api/v1/namespaces/default/services',
        {},
        (type: string, obj: k8s.V1Service) => {
          const service = this.convertK8sService(obj);

          if (service.type === query.type) {
            subscriber.next({
              type: type === 'ADDED' ? 'added' :
                    type === 'DELETED' ? 'removed' : 'updated',
              service,
              timestamp: new Date()
            });
          }
        },
        (err: unknown) => subscriber.error(err)
      );

      return () => req.abort();
    });
  }

  private convertK8sService(svc: k8s.V1Service): ServiceDescriptor {
    const labels = svc.metadata?.labels || {};
    const annotations = svc.metadata?.annotations || {};

    return {
      id: svc.metadata?.name || '',
      name: labels['app.kubernetes.io/name'] || svc.metadata?.name || '',
      type: labels['app.kubernetes.io/component'] || 'mcp-server',
      version: labels['app.kubernetes.io/version'] || '1.0.0',
      endpoint: `http://${svc.spec?.clusterIP}:${svc.spec?.ports?.[0].port}`,
      metadata: {
        tags: annotations['looopy/tags']?.split(',') || [],
        capabilities: JSON.parse(annotations['looopy/capabilities'] || '[]'),
        toolNames: JSON.parse(annotations['looopy/tools'] || '[]')
      }
    };
  }
}
```

## Tool Discovery

### Discovery Service

```typescript
class ToolDiscoveryService {
  private providers = new Map<string, ToolProvider>();

  constructor(
    private registry: ServiceRegistry,
    private router: ToolRouter
  ) {}

  /**
   * Start discovery process
   */
  start(): Observable<void> {
    // Initial discovery
    const initial$ = this.discoverTools().pipe(
      tap(() => logger.info('Initial tool discovery complete'))
    );

    // Watch for changes
    const watch$ = this.watchForChanges().pipe(
      tap(event => logger.info('Service changed', { event }))
    );

    return merge(initial$, watch$).pipe(
      map(() => void 0),
      catchError(error => {
        logger.error('Discovery error', { error });
        // Continue despite errors
        return EMPTY;
      })
    );
  }

  /**
   * Discover all available tools
   */
  private discoverTools(): Observable<void> {
    return this.registry.findServices({
      type: 'mcp-server',
      healthy: true
    }).pipe(
      mergeMap(services => from(services)),
      mergeMap(
        service => this.registerToolProvider(service),
        5 // Concurrent registrations
      ),
      toArray(),
      map(() => void 0)
    );
  }

  /**
   * Watch for service changes
   */
  private watchForChanges(): Observable<ServiceEvent> {
    return this.registry.watchServices({
      type: 'mcp-server'
    }).pipe(
      tap(event => {
        switch (event.type) {
          case 'added':
          case 'updated':
            this.registerToolProvider(event.service).subscribe();
            break;
          case 'removed':
            this.deregisterToolProvider(event.service.id);
            break;
        }
      })
    );
  }

  /**
   * Register a tool provider from service descriptor
   */
  private registerToolProvider(
    service: ServiceDescriptor
  ): Observable<void> {
    return of(service).pipe(
      // Check health first
      switchMap(svc =>
        this.registry.healthCheck(svc.id).pipe(
          map(health => ({ service: svc, health }))
        )
      ),

      // Only register healthy services
      filter(({ health }) => health.healthy),

      // Create provider
      switchMap(({ service }) => {
        const provider = new MCPToolProvider({
          serverId: service.id,
          serverUrl: service.endpoint,
          auth: service.metadata.auth
        });

        this.providers.set(service.id, provider);

        // Register with router
        this.router.registerProvider(provider);

        logger.info('Tool provider registered', {
          id: service.id,
          endpoint: service.endpoint
        });

        return of(void 0);
      }),

      catchError(error => {
        logger.error('Failed to register tool provider', {
          service: service.id,
          error
        });
        return EMPTY;
      })
    );
  }

  /**
   * Deregister a tool provider
   */
  private deregisterToolProvider(serviceId: string): void {
    const provider = this.providers.get(serviceId);

    if (provider) {
      this.router.deregisterProvider(provider.id);
      this.providers.delete(serviceId);

      logger.info('Tool provider deregistered', { id: serviceId });
    }
  }
}
```

## Agent Discovery

### Agent Registry

```typescript
interface AgentDescriptor {
  id: string;
  name: string;
  endpoint: string;
  capabilities: string[];
  version: string;
  metadata?: {
    description?: string;
    maxConcurrency?: number;
    costPerInvocation?: number;
  };
}

class AgentRegistry {
  private agents = new Map<string, AgentDescriptor>();

  constructor(private serviceRegistry: ServiceRegistry) {}

  /**
   * Start watching for agents
   */
  start(): Observable<void> {
    return this.serviceRegistry.watchServices({
      type: 'agent'
    }).pipe(
      tap(event => {
        switch (event.type) {
          case 'added':
          case 'updated':
            this.registerAgent(this.convertToAgentDescriptor(event.service));
            break;
          case 'removed':
            this.deregisterAgent(event.service.id);
            break;
        }
      }),
      map(() => void 0)
    );
  }

  /**
   * Find agents by capability
   */
  findByCapability(capability: string): AgentDescriptor[] {
    return Array.from(this.agents.values())
      .filter(agent => agent.capabilities.includes(capability));
  }

  /**
   * Get agent by ID
   */
  getAgent(id: string): AgentDescriptor | null {
    return this.agents.get(id) || null;
  }

  /**
   * Select best agent for task
   */
  selectAgent(requirements: {
    capabilities: string[];
    preferLowCost?: boolean;
    preferLowLatency?: boolean;
  }): AgentDescriptor | null {
    let candidates = Array.from(this.agents.values())
      .filter(agent =>
        requirements.capabilities.every(cap =>
          agent.capabilities.includes(cap)
        )
      );

    if (candidates.length === 0) return null;

    // Sort by preference
    if (requirements.preferLowCost) {
      candidates.sort((a, b) =>
        (a.metadata?.costPerInvocation || 0) -
        (b.metadata?.costPerInvocation || 0)
      );
    }

    return candidates[0];
  }

  private registerAgent(agent: AgentDescriptor): void {
    this.agents.set(agent.id, agent);
    logger.info('Agent registered', { id: agent.id });
  }

  private deregisterAgent(id: string): void {
    this.agents.delete(id);
    logger.info('Agent deregistered', { id });
  }

  private convertToAgentDescriptor(
    service: ServiceDescriptor
  ): AgentDescriptor {
    return {
      id: service.id,
      name: service.name,
      endpoint: service.endpoint,
      capabilities: service.metadata.capabilities || [],
      version: service.version,
      metadata: service.metadata as any
    };
  }
}
```

## Plugin System

### Plugin Loader

```typescript
interface ToolPlugin {
  name: string;
  version: string;
  tools: LocalTool[];
  initialize?(context: PluginContext): void | Promise<void>;
  dispose?(): void | Promise<void>;
}

interface PluginContext {
  config: Record<string, unknown>;
  logger: Logger;
}

class PluginLoader {
  private plugins = new Map<string, ToolPlugin>();

  /**
   * Load plugin from directory
   */
  async loadFromDirectory(pluginDir: string): Promise<void> {
    const entries = await fs.readdir(pluginDir, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory()) {
        await this.loadPlugin(path.join(pluginDir, entry.name));
      }
    }
  }

  /**
   * Load single plugin
   */
  async loadPlugin(pluginPath: string): Promise<void> {
    try {
      // Load package.json
      const pkgPath = path.join(pluginPath, 'package.json');
      const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf-8'));

      // Check if it's a valid plugin
      if (!pkg.keywords?.includes('looopy-plugin')) {
        return;
      }

      // Import plugin
      const main = pkg.main || 'index.js';
      const modulePath = path.join(pluginPath, main);
      const plugin: ToolPlugin = require(modulePath);

      // Initialize
      if (plugin.initialize) {
        await plugin.initialize({
          config: pkg['looopy'] || {},
          logger: logger.child({ plugin: plugin.name })
        });
      }

      // Store plugin
      this.plugins.set(plugin.name, plugin);

      logger.info('Plugin loaded', {
        name: plugin.name,
        version: plugin.version,
        tools: plugin.tools.length
      });
    } catch (error) {
      logger.error('Failed to load plugin', {
        path: pluginPath,
        error
      });
    }
  }

  /**
   * Get all tools from plugins
   */
  getAllTools(): LocalTool[] {
    return Array.from(this.plugins.values())
      .flatMap(plugin => plugin.tools);
  }

  /**
   * Unload all plugins
   */
  async unloadAll(): Promise<void> {
    for (const plugin of this.plugins.values()) {
      if (plugin.dispose) {
        await plugin.dispose();
      }
    }
    this.plugins.clear();
  }
}

// Usage
const pluginLoader = new PluginLoader();
await pluginLoader.loadFromDirectory('./plugins');

const tools = pluginLoader.getAllTools();
tools.forEach(tool => localProvider.register(tool));
```

### Example Plugin

```typescript
// plugins/weather-tools/index.ts

import { ToolPlugin, LocalTool } from 'looopy';
import { of } from 'rxjs';

const weatherTool: LocalTool = {
  name: 'get-weather',
  description: 'Get current weather for a location',
  parameters: {
    type: 'object',
    properties: {
      location: {
        type: 'string',
        description: 'City name or coordinates'
      }
    },
    required: ['location']
  },
  execute: (input, context) => {
    // Implementation
    return of({
      temperature: 72,
      conditions: 'Sunny'
    });
  }
};

export default {
  name: 'weather-tools',
  version: '1.0.0',
  tools: [weatherTool]
} as ToolPlugin;
```

## Multi-Tenant Discovery

### Tenant-Aware Registry

```typescript
class TenantAwareDiscoveryService extends ToolDiscoveryService {
  constructor(
    registry: ServiceRegistry,
    router: ToolRouter,
    private tenantService: TenantService
  ) {
    super(registry, router);
  }

  /**
   * Get tools available for a specific tenant
   */
  getToolsForTenant(
    tenantId: string,
    context: ExecutionContext
  ): Observable<ToolDefinition[]> {
    return this.tenantService.getTenantConfig(tenantId).pipe(
      switchMap(config => {
        // Filter by tenant's allowed tools
        const allowedProviders = config.allowedToolProviders || [];

        return this.router.getAvailableTools(context).pipe(
          map(tools => tools.filter(tool =>
            allowedProviders.includes(tool.metadata?.provider || '')
          ))
        );
      })
    );
  }

  /**
   * Register tenant-specific tool provider
   */
  registerTenantProvider(
    tenantId: string,
    provider: ToolProvider
  ): void {
    const wrappedProvider = new TenantScopedProvider(tenantId, provider);
    this.router.registerProvider(wrappedProvider);
  }
}

class TenantScopedProvider implements ToolProvider {
  readonly id: string;

  constructor(
    private tenantId: string,
    private wrapped: ToolProvider
  ) {
    this.id = `${tenantId}:${wrapped.id}`;
  }

  getTools(context: ExecutionContext): Observable<ToolDefinition[]> {
    // Only return tools if context matches tenant
    if (context.tenantId !== this.tenantId) {
      return of([]);
    }

    return this.wrapped.getTools(context);
  }

  execute(
    toolCall: ToolCall,
    context: ExecutionContext
  ): Observable<ToolResult> {
    // Enforce tenant isolation
    if (context.tenantId !== this.tenantId) {
      return throwError(() => new Error('Tenant mismatch'));
    }

    return this.wrapped.execute(toolCall, context);
  }

  // Delegate other methods...
  supports = this.wrapped.supports.bind(this.wrapped);
  getTool = this.wrapped.getTool.bind(this.wrapped);
  healthCheck = this.wrapped.healthCheck.bind(this.wrapped);
}
```

## Health Monitoring

### Provider Health Checks

```typescript
class HealthMonitor {
  private healthStatus = new Map<string, HealthStatus>();

  constructor(
    private providers: Map<string, ToolProvider>,
    private checkIntervalMs: number = 30000
  ) {}

  start(): Observable<void> {
    return interval(this.checkIntervalMs).pipe(
      switchMap(() => this.checkAllProviders()),
      tap(results => this.updateHealthStatus(results)),
      map(() => void 0)
    );
  }

  private checkAllProviders(): Observable<Map<string, HealthStatus>> {
    return from(this.providers.entries()).pipe(
      mergeMap(
        ([id, provider]) =>
          provider.healthCheck().pipe(
            map(health => ({ id, health })),
            catchError(() => of({
              id,
              health: {
                healthy: false,
                message: 'Health check failed'
              }
            }))
          ),
        10 // Concurrent checks
      ),
      reduce(
        (acc, { id, health }) => acc.set(id, health),
        new Map<string, HealthStatus>()
      )
    );
  }

  private updateHealthStatus(
    results: Map<string, HealthStatus>
  ): void {
    results.forEach((health, id) => {
      const previous = this.healthStatus.get(id);
      this.healthStatus.set(id, health);

      // Emit events on status changes
      if (previous?.healthy !== health.healthy) {
        logger.info('Provider health changed', {
          id,
          healthy: health.healthy,
          message: health.message
        });

        if (!health.healthy) {
          // Could trigger circuit breaker, alerts, etc.
        }
      }
    });
  }

  getHealth(providerId: string): HealthStatus | null {
    return this.healthStatus.get(providerId) || null;
  }
}
```
