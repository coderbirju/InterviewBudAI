import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

// Loading the `@ibai/storage` root pulls in the concrete
// `LocalFileStorageAdapter` (the barrel re-exports it). Core depends on
// storage *interfaces* only, so its runtime module graph must never load the
// root: runtime values come from side-effect-free subpaths such as
// `@ibai/storage/competency`; everything else is `import type` (erased).
vi.mock('@ibai/storage', () => {
  throw new Error('@ibai/core loaded the @ibai/storage root at runtime');
});

const srcDir = dirname(fileURLToPath(import.meta.url));

describe('@ibai/core runtime module graph', () => {
  it('imports core without loading the @ibai/storage root (adapter)', async () => {
    const core = await import('./index.js');
    expect(core.PACKAGE_NAME).toBe('@ibai/core');
    expect(typeof core.deriveGuidance).toBe('function');
  });

  it('has no value import/export from the @ibai/storage root in any source file', () => {
    const offenders: string[] = [];
    for (const file of readdirSync(srcDir)) {
      if (!file.endsWith('.ts') || file.endsWith('.test.ts')) continue;
      const text = readFileSync(join(srcDir, file), 'utf8');
      // Every import/export statement ending in `from '@ibai/storage'`.
      const re =
        /(^|\n)\s*(import|export)(\s+type)?\b[^;]*?from\s+'@ibai\/storage'/g;
      for (const m of text.matchAll(re)) {
        if (!m[3]) offenders.push(`${file}: ${m[0].trim().split('\n')[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
