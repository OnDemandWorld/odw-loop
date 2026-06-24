/**
 * Secrets manager — CRUD on top of the StateStore with encryption at rest.
 */

import { randomUUID } from 'node:crypto';
import { createLogger } from '@loop/observability';
import type { StateStore } from '@loop/state';
import { deriveKey, encrypt, decrypt, type EncryptedPayload } from './encryption.js';

const logger = createLogger({ name: 'loop:secrets', component: 'secrets' });

export class SecretsManager {
  private executionKey: Buffer;
  private secretsKey: Buffer;

  constructor(
    private store: StateStore,
    masterKey: string,
  ) {
    this.executionKey = deriveKey(masterKey, 'execution');
    this.secretsKey = deriveKey(masterKey, 'secrets');
  }

  /** Create or update a secret (encrypted). */
  async set(params: {
    name: string;
    value: string;
    scope: 'global' | 'workflow' | 'connector';
    scope_id?: string;
    created_by: string;
  }): Promise<{ id: string }> {
    const encrypted = encrypt(params.value, this.secretsKey);
    const payload = JSON.stringify(encrypted);

    const existing = await this.store.secrets.getByName(params.name, params.scope, params.scope_id);
    if (existing) {
      await this.store.secrets.update(existing.id, payload);
      logger.info({ name: params.name, scope: params.scope }, 'Secret updated');
      return { id: existing.id };
    }

    const id = randomUUID();
    const createParams: { id: string; name: string; encrypted_value: string; scope: 'global' | 'workflow' | 'connector'; created_by: string; scope_id?: string } = {
      id,
      name: params.name,
      encrypted_value: payload,
      scope: params.scope,
      created_by: params.created_by,
    };
    if (params.scope_id !== undefined) createParams.scope_id = params.scope_id;
    await this.store.secrets.create(createParams);
    logger.info({ name: params.name, scope: params.scope }, 'Secret created');
    return { id };
  }

  /** Read and decrypt a secret by name. */
  async get(name: string, scope?: string, scope_id?: string): Promise<string | null> {
    const row = await this.store.secrets.getByName(name, scope, scope_id);
    if (!row) return null;
    const payload: EncryptedPayload = JSON.parse(row.encrypted_value);
    return decrypt(payload, this.secretsKey);
  }

  /** List secrets (metadata only — values stay encrypted). */
  async list(scope?: string, scope_id?: string) {
    return this.store.secrets.list(scope, scope_id);
  }

  /** Delete a secret. */
  async delete(id: string): Promise<void> {
    await this.store.secrets.delete(id);
  }

  /** Encrypt execution I/O data. */
  encryptExecutionData(data: unknown): string {
    return JSON.stringify(encrypt(JSON.stringify(data), this.executionKey));
  }

  /** Decrypt execution I/O data. */
  decryptExecutionData(encrypted: string): unknown {
    const payload: EncryptedPayload = JSON.parse(encrypted);
    return JSON.parse(decrypt(payload, this.executionKey));
  }
}
