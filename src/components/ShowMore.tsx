import Link from "next/link";
import { MAX_SHOW, PAGE_SIZE, moreCount, nextShow, showMoreHref } from "@/lib/pagination";

// The caption and the "Show 25 more" link under a long list. Renders nothing
// for a list that fits in one page. `params` is the page's own search
// parameters, so the segment and anything else in the URL is kept.
export default function ShowMore({
  path,
  params,
  show,
  total,
}: {
  path: string;
  params: Record<string, string | string[] | undefined>;
  show: number;
  total: number;
}) {
  if (total <= PAGE_SIZE) return null;
  const shown = Math.min(show, total);
  const next = nextShow(show, total);
  return (
    <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-zinc-500">
      <span>{shown >= total ? `Showing all ${total}` : `Showing ${shown} of ${total}`}</span>
      {next !== null && (
        <Link
          href={showMoreHref(path, params, next)}
          scroll={false}
          className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-sm text-zinc-800 hover:bg-zinc-50"
        >
          Show {moreCount(show, total)} more
        </Link>
      )}
      {next === null && shown < total && (
        <span>The most that can be shown here is {MAX_SHOW}. Export everything from the Data page.</span>
      )}
    </div>
  );
}
