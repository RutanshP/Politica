import { cn } from "@/lib/utils";

const PREVIEW = 900;
/** Beyond this the rest is not sent at all -- H.R. 1's summary alone is 174KB. */
const MAX_INLINE = 12_000;

/**
 * Long text shown as a preview that opens in place. A native <details>, so it needs no client
 * JavaScript. Short text renders as a plain paragraph.
 */
export function CollapsibleText({
  text,
  className,
  moreHref,
  moreLabel = "Full summary on Congress.gov",
}: {
  text: string;
  className?: string;
  /** Where the full text lives when it is too long to send inline. */
  moreHref?: string;
  moreLabel?: string;
}) {
  const body = cn("whitespace-pre-line text-[13px] leading-relaxed text-[var(--muted)]", className);
  if (text.length <= PREVIEW * 1.3) return <p className={body}>{text}</p>;

  const cut = text.slice(0, PREVIEW).search(/\s\S*$/);
  const head = text.slice(0, cut > 0 ? cut : PREVIEW);
  const truncated = text.length > MAX_INLINE;
  const rest = truncated
    ? text.slice(head.length, MAX_INLINE).replace(/\s+\S*$/, "")
    : text.slice(head.length);

  return (
    <div className="group/collapsible">
      <p className={body}>
        {head}
        <span className="group-has-[details[open]]/collapsible:hidden">…</span>
      </p>
      <details className="group/details">
        <summary className="mt-2 cursor-pointer list-none text-xs font-medium text-[var(--accent-2)] hover:text-[#a5adff]">
          <span className="group-open/details:hidden">Read more</span>
          <span className="hidden group-open/details:inline">Show less</span>
        </summary>
        <p className={cn(body, "mt-2")}>
          {rest.trimStart()}
          {truncated ? "…" : ""}
        </p>
        {truncated && moreHref ? (
          <a
            href={moreHref}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-block text-xs font-medium text-[var(--accent-2)] hover:text-[#a5adff]"
          >
            {moreLabel} →
          </a>
        ) : null}
      </details>
    </div>
  );
}
