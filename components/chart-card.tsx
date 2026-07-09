import { SectionCard } from "@/components/section-card";

export function ChartCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <SectionCard title={title} description={description}>
      <div className="h-[260px]">{children}</div>
    </SectionCard>
  );
}
