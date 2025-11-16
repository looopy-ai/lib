import { afterEach, describe, expect, it, vi } from 'vitest';
import { registerSignalListener, unregisterSignalListener } from './process-signals';

describe('process signal coordinator', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('dispatches signals to all registered listeners', async () => {
    const onSpy = vi.spyOn(process, 'on');

    const listenerOne = vi.fn();
    const listenerTwo = vi.fn().mockResolvedValue(undefined);

    registerSignalListener('SIGTERM', listenerOne);
    registerSignalListener('SIGTERM', listenerTwo);

    expect(onSpy).toHaveBeenCalledTimes(1);

    process.emit('SIGTERM');

    await new Promise((resolve) => setImmediate(resolve));

    expect(listenerOne).toHaveBeenCalledTimes(1);
    expect(listenerTwo).toHaveBeenCalledTimes(1);

    unregisterSignalListener('SIGTERM', listenerOne);
    unregisterSignalListener('SIGTERM', listenerTwo);
  });

  it('removes the process handler when the last listener is unregistered', () => {
    const offSpy =
      typeof process.off === 'function'
        ? vi.spyOn(process, 'off')
        : vi.spyOn(process, 'removeListener');

    const listener = vi.fn();

    registerSignalListener('SIGTERM', listener);
    unregisterSignalListener('SIGTERM', listener);

    expect(offSpy).toHaveBeenCalledTimes(1);
  });
});
