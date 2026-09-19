import { notFound, redirect } from "next/navigation";

import { findEntityById } from "@/lib/data/entities";

export const revalidate = 21600;

/**
 * Resolves an entity id (a bill id, member slug, committee slug...) to its real page.
 *
 * This used to render a generic shell -- "Title: … Meta: …" and a note about future graph nodes --
 * that only duplicated a link to the primary page. Nothing in the app links here any more; it is
 * kept so old links still land somewhere useful.
 */
export default async function EntityPage({ params }: { params: Promise<{ entityId: string }> }) {
  const { entityId } = await params;
  const entity = await findEntityById(entityId);
  if (!entity) notFound();
  redirect(entity.href);
}
