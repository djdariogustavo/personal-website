import type { DB } from './db.ts';
import type { Vault } from './crypto.ts';
import type { PaymentRegistry } from './payments/index.ts';
import type { Companion } from './companion.ts';
import type { Messenger, GuardNotifier } from './notify.ts';
import type { RemoteConfig } from '@serena/domain';

export interface AppContext {
  db: DB;
  vault: Vault;
  jwtKey: Uint8Array;
  publicUrl: string;
  exposeDevOtp: boolean;
  config: RemoteConfig;
  payments: PaymentRegistry;
  companion: Companion;
  messenger: Messenger;
  guard: GuardNotifier;
}
