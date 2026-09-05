import { describe, it, expect } from 'vitest';
import { PACKAGE_NAME, engineReady } from './index.js';

describe('@ibai/core scaffold', () => {
  it('exposes its package name', () => {
    expect(PACKAGE_NAME).toBe('@ibai/core');
  });

  it('reports the engine module is importable', () => {
    expect(engineReady()).toBe(true);
  });
});
