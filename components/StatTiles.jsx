import Link from "next/link";
import Icon from "./Icon";

/** A row of clickable summary tiles: each shows a number and goes to where that number can be acted on. */
export default function StatTiles({ tiles, label = "At a glance" }) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label={label}>
      {tiles.map((t) => (
        <li key={t.label}>
          <Link href={t.href} className="stat">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-paper text-brand"><Icon name={t.icon} /></span>
            <span className="min-w-0 flex-1">
              <span className="block text-2xl font-semibold leading-none text-ink">{t.value.toLocaleString()}</span>
              <span className="mt-1 block text-sm text-ink">{t.label}</span>
              <span className="block text-xs text-muted">{t.sub}</span>
            </span>
            <span className="text-muted"><Icon name="chevron" className="h-4 w-4" /></span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
