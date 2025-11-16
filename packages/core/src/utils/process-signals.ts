import { getLogger } from '../core/logger';
import { serializeError } from './error';

export type SignalListener = () => void | Promise<void>;

const listeners = new Map<NodeJS.Signals, Set<SignalListener>>();
const processHandlers = new Map<NodeJS.Signals, () => void>();
const signalLogger = getLogger({ component: 'process-signal-coordinator' });

function isProcessAvailable(): boolean {
  return typeof process !== 'undefined' && typeof process.on === 'function';
}

/**
 * Register a listener that should be invoked when the Node.js process receives the given signal.
 * The process will only install a single handler per signal regardless of how many listeners are registered.
 */
export function registerSignalListener(signal: NodeJS.Signals, listener: SignalListener): void {
  if (!isProcessAvailable()) {
    return;
  }

  const signalListeners = listeners.get(signal) ?? new Set<SignalListener>();
  signalListeners.add(listener);
  listeners.set(signal, signalListeners);

  ensureProcessHandler(signal);
}

/**
 * Remove a previously registered signal listener.
 * When the last listener for a signal is removed, the process level handler is also cleaned up.
 */
export function unregisterSignalListener(signal: NodeJS.Signals, listener: SignalListener): void {
  if (!isProcessAvailable()) {
    return;
  }

  const signalListeners = listeners.get(signal);
  if (!signalListeners) {
    return;
  }

  signalListeners.delete(listener);

  if (signalListeners.size === 0) {
    listeners.delete(signal);
    removeProcessHandler(signal);
  }
}

function ensureProcessHandler(signal: NodeJS.Signals): void {
  if (processHandlers.has(signal)) {
    return;
  }

  const handler = (): void => {
    const signalListeners = listeners.get(signal);
    if (!signalListeners || signalListeners.size === 0) {
      return;
    }

    signalLogger.info(
      { signal, listenerCount: signalListeners.size },
      'Received process signal; notifying registered listeners',
    );

    const listenersSnapshot = Array.from(signalListeners);
    void Promise.allSettled(
      listenersSnapshot.map(async (listener) => {
        try {
          await listener();
        } catch (error) {
          signalLogger.error({ signal, error: serializeError(error) }, 'Signal listener failed');
        }
      }),
    );
  };

  process.on(signal, handler);
  processHandlers.set(signal, handler);
}

function removeProcessHandler(signal: NodeJS.Signals): void {
  const handler = processHandlers.get(signal);
  if (!handler) {
    return;
  }

  if (typeof process.off === 'function') {
    process.off(signal, handler);
  } else if (typeof process.removeListener === 'function') {
    process.removeListener(signal, handler);
  }

  processHandlers.delete(signal);
}
