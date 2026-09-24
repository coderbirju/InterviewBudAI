import type { Difficulty } from '../lib/api';
import { difficultyBadgeClasses } from '../lib/home';

/** A small pill showing a problem's difficulty in the strict token colors. */
export function DifficultyBadge({
  difficulty,
}: {
  difficulty: Difficulty;
}): JSX.Element {
  return (
    <span
      className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium transition-all duration-200 ${difficultyBadgeClasses(
        difficulty,
      )}`}
    >
      {difficulty}
    </span>
  );
}
