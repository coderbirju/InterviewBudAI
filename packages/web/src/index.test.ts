import { describe, it, expect } from 'vitest';
import { PACKAGE_NAME, webCanReachEngine } from './index.js';

describe('@ibai/web scaffold', () => {
  it('exposes its package name', () => {
    expect(PACKAGE_NAME).toBe('@ibai/web');
  });

  it('can reach the core engine (web -> core)', () => {
    expect(webCanReachEngine()).toBe(true);
  });
});
