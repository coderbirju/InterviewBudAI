/**
 * @ibai/web — thin, locally hosted web front-end.
 *
 * Same engine as the CLI (front-end parity): capabilities live in @ibai/core
 * and the web app exposes them. Concrete adapters are injected at startup.
 *
 * Scaffold placeholder; it imports @ibai/core only to prove the dependency
 * direction (web -> core) compiles.
 */
import { engineReady } from '@ibai/core';

export const PACKAGE_NAME = '@ibai/web';

/** Confirms the web front-end can reach the engine. */
export function webCanReachEngine(): boolean {
  return engineReady();
}
