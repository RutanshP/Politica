import { Card, CardBody } from "@/components/ui/card";

/**
 * Compatibility wrapper over Card for the ~20 pages that predate it. New screens should compose
 * Card / CardHeader / CardBody directly -- this exists so a page can be re-themed without being
 * rewritten, and it keeps the description slot those pages rely on.
 */
export function SectionCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <div className="flex-none border-b border-[var(--line)] px-4 py-3.5">
        <h2 className="text-sm font-semibold text-[var(--ink)]">{title}</h2>
        {description ? (
          <p className="mt-1 text-xs leading-relaxed text-[var(--muted)]">{description}</p>
        ) : null}
      </div>
      <CardBody>{children}</CardBody>
    </Card>
  );
}
