/**
 * @ibai/cli — thin CLI front-end.
 *
 * Front-ends are thin over the engine: capabilities live in @ibai/core and the
 * CLI exposes them (front-end parity principle). At startup a front-end wires
 * concrete provider/storage adapters into the engine (dependency injection).
 *
 * Scaffold placeholder; it imports @ibai/core only to prove the dependency
 * direction (cli -> core) compiles.
 */
import { engineReady } from '@ibai/core';

export const PACKAGE_NAME = '@ibai/cli';

/** Confirms the CLI can reach the engine. */
export function cliCanReachEngine(): boolean {
  return engineReady();
}
