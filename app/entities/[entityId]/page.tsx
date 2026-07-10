import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/page-header";
import { SectionCard } from "@/components/section-card";
import { findEntityById } from "@/lib/data/entities";

export const revalidate = 21600;

export default async function EntityPage({
  params,
}: {
  params: Promise<{ entityId: string }>;
}) {
  const { entityId } = await params;
  const entity = await findEntityById(entityId);

  if (!entity) notFound();

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={`Entity · ${entity.type}`}
        title={entity.label}
        description={entity.description}
      />
      <SectionCard title="Entity overview">
        <div className="space-y-4 text-sm text-[var(--muted)]">
          <p>Title: {entity.title}</p>
          <p>Meta: {entity.meta}</p>
          <p>This generic entity route helps future graph nodes and search results resolve into a consistent detail shell.</p>
          <Link href={entity.href} className="inline-flex rounded-full bg-[var(--accent)] px-4 py-2 font-semibold text-white">
            Open primary page
          </Link>
        </div>
      </SectionCard>
    </div>
  );
}
