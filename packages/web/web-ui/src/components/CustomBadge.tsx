/** "Custom" pill for a user-added problem (ADR 0010 D5). */
export function CustomBadge(): JSX.Element {
  return (
    <span className="inline-block rounded-full border border-sky-500/40 bg-sky-500/10 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-sky-300">
      Custom
    </span>
  );
}
