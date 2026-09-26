import * as Keychain from 'react-native-keychain';
import type { SecretStore } from '../../src/application/llm/types';

const PREFIX = 'com.shineword.app.secret.';

function service(keyRef: string): string {
  return `${PREFIX}${keyRef}`;
}

export class KeychainSecretStore implements SecretStore {
  async set(keyRef: string, secret: string): Promise<void> {
    if (!keyRef.trim() || !secret) throw new Error('keyRef and secret are required.');
    await Keychain.setGenericPassword(keyRef, secret, {
      service: service(keyRef),
      accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  }

  async get(keyRef: string): Promise<string | null> {
    const value = await Keychain.getGenericPassword({ service: service(keyRef) });
    return value ? value.password : null;
  }

  async delete(keyRef: string): Promise<void> {
    await Keychain.resetGenericPassword({ service: service(keyRef) });
  }
}
