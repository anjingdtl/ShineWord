import type { SecretStore } from './types';

export class MemorySecretStore implements SecretStore {
  private readonly values = new Map<string, string>();

  async set(keyRef: string, secret: string): Promise<void> {
    if (!keyRef.trim()) throw new Error('keyRef is required.');
    if (!secret) throw new Error('secret is required.');
    this.values.set(keyRef, secret);
  }

  async get(keyRef: string): Promise<string | null> {
    return this.values.get(keyRef) ?? null;
  }

  async delete(keyRef: string): Promise<void> {
    this.values.delete(keyRef);
  }
}
