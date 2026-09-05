import { describe, it, expect } from 'vitest';
import { PACKAGE_NAME, cliCanReachEngine } from './index.js';

describe('@ibai/cli scaffold', () => {
  it('exposes its package name', () => {
    expect(PACKAGE_NAME).toBe('@ibai/cli');
  });

  it('can reach the core engine (cli -> core)', () => {
    expect(cliCanReachEngine()).toBe(true);
  });
});
