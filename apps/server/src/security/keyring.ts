import type { SecretStatus, SecretStore } from './secrets';

export class KeyringStore implements SecretStore {
  async status(): Promise<SecretStatus> {
    return { kind: 'keyring', exists: true, locked: false };
  }

  get(name: string) {
    return Bun.secrets.get({ service: 'squad-dashboard', name });
  }

  async set(name: string, value: string) {
    await Bun.secrets.set({ service: 'squad-dashboard', name, value });
  }

  async delete(name: string) {
    await Bun.secrets.delete({ service: 'squad-dashboard', name });
  }
}
