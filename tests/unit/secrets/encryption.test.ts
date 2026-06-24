import { describe, it, expect } from 'vitest';
import { encrypt, decrypt, deriveKey, type EncryptedPayload } from '../../../packages/secrets/src/encryption';

describe('@loop/secrets — encryption', () => {
  const masterKey = 'test-master-key-with-sufficient-entropy-for-testing-purposes';

  describe('deriveKey', () => {
    it('produces consistent keys for the same context', () => {
      const a = deriveKey(masterKey, 'execution');
      const b = deriveKey(masterKey, 'execution');
      expect(a).toEqual(b);
      expect(a).toBeInstanceOf(Buffer);
      expect(a.length).toBe(32); // 256 bits
    });

    it('produces different keys for different contexts', () => {
      const executionKey = deriveKey(masterKey, 'execution');
      const secretsKey = deriveKey(masterKey, 'secrets');
      expect(executionKey.equals(secretsKey)).toBe(false);
    });

    it('produces different keys for different master keys', () => {
      const a = deriveKey('master-key-A-with-enough-entropy-here', 'execution');
      const b = deriveKey('master-key-B-with-enough-entropy-here', 'execution');
      expect(a.equals(b)).toBe(false);
    });
  });

  describe('encrypt / decrypt round-trip', () => {
    it('decrypt(encrypt(data)) === data', () => {
      const key = deriveKey(masterKey, 'secrets');
      const plaintext = 'super-secret-api-key-12345';
      const payload = encrypt(plaintext, key);
      const decrypted = decrypt(payload, key);
      expect(decrypted).toBe(plaintext);
    });

    it('handles empty string encryption', () => {
      const key = deriveKey(masterKey, 'secrets');
      const payload = encrypt('', key);
      expect(decrypt(payload, key)).toBe('');
    });

    it('handles unicode content', () => {
      const key = deriveKey(masterKey, 'secrets');
      const plaintext = 'こんにちは世界 🌍 — Ñoño';
      const payload = encrypt(plaintext, key);
      expect(decrypt(payload, key)).toBe(plaintext);
    });

    it('each encryption produces a unique IV (non-deterministic)', () => {
      const key = deriveKey(masterKey, 'secrets');
      const plaintext = 'same-data';
      const a = encrypt(plaintext, key);
      const b = encrypt(plaintext, key);
      expect(a.iv).not.toBe(b.iv);
      // ciphertext should also differ due to unique IV
      expect(a.ciphertext).not.toBe(b.ciphertext);
    });

    it('payload contains base64-encoded ciphertext, iv, and tag', () => {
      const key = deriveKey(masterKey, 'secrets');
      const payload = encrypt('data', key);
      const b64 = /^[A-Za-z0-9+/=]+$/;
      expect(payload.ciphertext).toMatch(b64);
      expect(payload.iv).toMatch(b64);
      expect(payload.tag).toMatch(b64);
      // IV is 12 bytes → 16 base64 chars
      expect(Buffer.from(payload.iv, 'base64').length).toBe(12);
      // GCM auth tag is 16 bytes → 24 base64 chars (with padding)
      expect(Buffer.from(payload.tag, 'base64').length).toBe(16);
    });

    it('fails to decrypt with the wrong key', () => {
      const key1 = deriveKey(masterKey, 'secrets');
      const key2 = deriveKey('different-master-key-for-testing-only', 'secrets');
      const payload = encrypt('secret', key1);
      expect(() => decrypt(payload, key2)).toThrow();
    });

    it('fails to decrypt when the tag is tampered with', () => {
      const key = deriveKey(masterKey, 'secrets');
      const payload = encrypt('secret', key);
      const tampered: EncryptedPayload = {
        ...payload,
        // flip a character in the tag
        tag: payload.tag.replace(/^./, (c) => (c === 'A' ? 'B' : 'A')),
      };
      expect(() => decrypt(tampered, key)).toThrow();
    });
  });
});
