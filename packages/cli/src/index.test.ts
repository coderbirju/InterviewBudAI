/**
 * Tests for @ibai/cli public exports.
 *
 * Verifies that the package surface is accessible and the CLI can reach core.
 */

import { describe, it, expect } from 'vitest';
import { run, formatAssessment, resolveDataDir } from './index.js';

describe('@ibai/cli exports', () => {
  it('exports run function', () => {
    expect(typeof run).toBe('function');
  });

  it('exports formatAssessment function', () => {
    expect(typeof formatAssessment).toBe('function');
  });

  it('exports resolveDataDir function', () => {
    expect(typeof resolveDataDir).toBe('function');
  });
});
