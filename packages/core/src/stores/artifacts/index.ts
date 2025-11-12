/**
 * Artifact Store Exports
 *
 * Implementation uses discriminated unions for type safety.
 * See: ai-journal/DISCRIMINATED_UNIONS_REFACTOR.md
 */

export { ArtifactScheduler } from './artifact-scheduler';
export {
  InternalEventArtifactStore,
  type InternalEventArtifactStoreConfig,
  type InternalEventEmitter,
} from './internal-event-artifact-store';
export { InMemoryArtifactStore } from './memory-artifact-store';
