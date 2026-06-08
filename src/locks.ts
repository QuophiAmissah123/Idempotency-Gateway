import { EventEmitter } from 'events';

class LockManager {
  private inFlightKeys = new Set<string>();
  private emitter = new EventEmitter();

  constructor() {
    this.emitter.setMaxListeners(200);
  }

  /**
   * Tries to acquire a lock for the given key.
   * If the key is already processing (in-flight), returns a Promise that resolves
   * when the in-flight process finishes.
   * Returns true if lock was acquired (caller is the first/primary request).
   * Returns false if lock was not acquired (meaning caller waited and the primary request finished).
   */
  async acquire(key: string): Promise<boolean> {
    if (!this.inFlightKeys.has(key)) {
      this.inFlightKeys.add(key);
      return true;
    }

    // Wait until the key is released
    await new Promise<void>((resolve) => {
      this.emitter.once(`release:${key}`, resolve);
    });

    return false;
  }

  /**
   * Releases the lock for the given key and notifies all waiting requests.
   */
  release(key: string): void {
    if (this.inFlightKeys.has(key)) {
      this.inFlightKeys.delete(key);
      this.emitter.emit(`release:${key}`);
    }
  }
}

export const lockManager = new LockManager();
