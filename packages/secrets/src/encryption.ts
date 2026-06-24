/**
 * AES-256-GCM encryption with HKDF key derivation (§11.4).
 *
 * Each encrypted field gets its own random IV.  The output format is a JSON string:
 * { "ciphertext": "<base64>", "iv": "<base64>", "tag": "<base64>" }
 */

import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96 bits for GCM
const KEY_LENGTH = 32; // 256 bits
const HKDF_INFO_EXECUTION = 'loop-execution-data';
const HKDF_INFO_SECRETS = 'loop-secrets';

export interface EncryptedPayload {
  ciphertext: string; // base64
  iv: string; // base64
  tag: string; // base64
}

/** Derive a 256-bit sub-key from the master key using HKDF. */
export function deriveKey(masterKey: string, context: 'execution' | 'secrets'): Buffer {
  const info = context === 'execution' ? HKDF_INFO_EXECUTION : HKDF_INFO_SECRETS;
  const salt = Buffer.alloc(0); // No salt — master key already has entropy
  const derived = hkdfSync('sha256', masterKey, salt, info, KEY_LENGTH);
  return Buffer.from(derived);
}

/** Encrypt a value using AES-256-GCM. */
export function encrypt(plaintext: string, key: Buffer): EncryptedPayload {
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
  };
}

/** Decrypt a value encrypted by `encrypt()`. */
export function decrypt(payload: EncryptedPayload, key: Buffer): string {
  const iv = Buffer.from(payload.iv, 'base64');
  const ciphertext = Buffer.from(payload.ciphertext, 'base64');
  const tag = Buffer.from(payload.tag, 'base64');
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString('utf8');
}
