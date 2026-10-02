import { afterEach, describe, expect, it } from 'vitest';
import { isValidStyleNonce, readStyleNonce } from './nonce';

/** ADR 0014 D2: only a real 16-byte base64 nonce starts the editor. */

const VALID = 'AAECAwQFBgcICQoLDA0ODw=='; // 16 bytes, base64

function setMeta(nonce: string | null): void {
  document.head.querySelector('meta[name="ibai-style-nonce"]')?.remove();
  const meta = document.createElement('meta');
  meta.setAttribute('name', 'ibai-style-nonce');
  if (nonce !== null) meta.setAttribute('nonce', nonce);
  document.head.appendChild(meta);
}

afterEach(() => {
  document.head.querySelector('meta[name="ibai-style-nonce"]')?.remove();
});

describe('isValidStyleNonce', () => {
  it('accepts the shape of 16 random bytes in base64', () => {
    expect(isValidStyleNonce(VALID)).toBe(true);
    expect(isValidStyleNonce('ab+/AB09ab+/AB09ab+/AA==')).toBe(true);
  });

  it.each([
    ['the unreplaced placeholder', '__IBAI_STYLE_NONCE__'],
    ['empty', ''],
    ['too short', 'AAECAwQFBgcICQoLDA0O=='],
    ['no padding', 'AAECAwQFBgcICQoLDA0ODw'],
    ['url-safe alphabet', 'AAECAwQFBgcICQoLDA0OD-=='],
    ['quote injection', "AAECAwQFBgcICQoLDA'Ow=="],
    ['trailing newline', VALID + '\n'],
  ])('rejects %s', (_label, value) => {
    expect(isValidStyleNonce(value)).toBe(false);
  });

  it('rejects non-strings', () => {
    expect(isValidStyleNonce(null)).toBe(false);
    expect(isValidStyleNonce(undefined)).toBe(false);
  });
});

describe('readStyleNonce', () => {
  it('returns null without the meta element', () => {
    expect(readStyleNonce()).toBeNull();
  });

  it('reads a valid nonce through the getAttribute fallback', () => {
    setMeta(VALID);
    expect(readStyleNonce()).toBe(VALID);
  });

  it('prefers the nonce IDL property (browsers hide the attribute)', () => {
    setMeta('');
    const meta = document.head.querySelector(
      'meta[name="ibai-style-nonce"]',
    ) as HTMLElement;
    meta.nonce = VALID;
    expect(readStyleNonce()).toBe(VALID);
  });

  it.each([['__IBAI_STYLE_NONCE__'], [''], ['not-a-nonce']])(
    'returns null for %j',
    (value) => {
      setMeta(value);
      expect(readStyleNonce()).toBeNull();
    },
  );

  it('returns null when the attribute is missing', () => {
    setMeta(null);
    expect(readStyleNonce()).toBeNull();
  });
});
