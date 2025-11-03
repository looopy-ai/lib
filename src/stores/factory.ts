/**
 * Store Factory
 *
 * Creates state and artifact store instances based on configuration.
 * Supports multiple backend implementations (Redis, Memory, S3, etc.)
 *
 * Design Reference: design/agent-loop.md#store-factory-pattern
 */

import type { ArtifactStore, StateStore } from '../core/types';
import type { RedisClient, S3Client } from '../types';
import { InMemoryArtifactStore } from './memory/memory-artifact-store';
import { InMemoryStateStore } from './memory/memory-state-store';
import { RedisArtifactStore } from './redis/redis-artifact-store';
import { RedisStateStore } from './redis/redis-state-store';

export interface StoreConfig {
  state: {
    type: 'redis' | 'memory';
    redis?: RedisClient;
    ttl?: number;
  };
  artifact: {
    type: 'redis' | 'memory' | 's3';
    redis?: RedisClient;
    s3?: S3Client;
    inlineMaxSize?: number;
    ttl?: number;
    storageBackend?: 'redis' | 's3' | 'local';
  };
}

export const StoreFactory = {
  /**
   * Create a state store instance based on configuration
   */
  createStateStore(config: StoreConfig['state']): StateStore {
    switch (config.type) {
      case 'redis':
        if (!config.redis) {
          throw new Error('Redis client required for redis state store');
        }
        return new RedisStateStore(config.redis, config.ttl);

      case 'memory':
        return new InMemoryStateStore();

      default:
        throw new Error(`Unknown state store type: ${config.type}`);
    }
  },

  /**
   * Create an artifact store instance based on configuration
   */
  createArtifactStore(config: StoreConfig['artifact']): ArtifactStore {
    switch (config.type) {
      case 'redis':
      case 's3':
        if (!config.redis) {
          throw new Error('Redis client required for redis/s3 artifact store');
        }
        return new RedisArtifactStore(config.redis, config.s3, {
          inlineMaxSize: config.inlineMaxSize || 1024 * 1024,
          ttl: config.ttl || 24 * 60 * 60,
          storageBackend: config.storageBackend || 'redis',
        });

      case 'memory':
        return new InMemoryArtifactStore();

      default:
        throw new Error(`Unknown artifact store type: ${config.type}`);
    }
  },
} as const;
