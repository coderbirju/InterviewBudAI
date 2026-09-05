/**
 * @ibai/storage — the progress-layer persistence boundary.
 *
 * Will expose the pluggable storage *interface* and adapters. The default
 * adapter is git-backed local files (human-readable, diffable, private). User
 * progress data is owned by the user and is NEVER committed to this repo
 * (see ADR 0001 D3/D4).
 *
 * Scaffold placeholder; the interface contract lands in a subsequent ADR-backed
 * PR.
 */

export const PACKAGE_NAME = '@ibai/storage';
