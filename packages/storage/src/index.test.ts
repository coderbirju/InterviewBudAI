import { describe, it, expect } from 'vitest';
import { PACKAGE_NAME } from './index.js';

describe('@ibai/storage scaffold', () => {
  it('exposes its package name', () => {
    expect(PACKAGE_NAME).toBe('@ibai/storage');
  });
});
