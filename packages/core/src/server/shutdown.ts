import { getLogger } from '../core';

type ShutdownWatcher = {
  handleShutdown: () => Promise<void>;
  order: number;
};

export class ShutdownManager {
  private watchers: ShutdownWatcher[] = [];

  constructor() {
    process.on('SIGINT', this.signalHandler.bind(this));
    process.on('SIGTERM', this.signalHandler.bind(this));
  }

  registerWatcher(handleShutdown: () => Promise<void>, order = 100): void {
    this.watchers.push({ handleShutdown, order });
    this.watchers.sort((a, b) => a.order - b.order);
  }

  async initiateShutdown(): Promise<void> {
    for (const watcher of this.watchers) {
      await watcher.handleShutdown();
    }
  }

  private signalHandler(signal: NodeJS.Signals): void {
    getLogger({ component: 'shutdown-manager' }).info(
      { signal, watchers: this.watchers.length },
      'Received shutdown signal',
    );
    this.initiateShutdown();
  }
}
