import { BillsDirectory } from "@/components/bills-directory";
import { PageHeader } from "@/components/page-header";
import { SourceBadge } from "@/components/source-badge";
import { Card, CardBody, CardHeader, CardNote } from "@/components/ui/card";
import { WithRail } from "@/components/ui/layout";
import { MeterRow } from "@/components/ui/meter";
import { TopicIcon } from "@/components/ui/topic-icon";
import { BILL_STATUS_TONE, TONE_COLOR } from "@/components/ui/tones";
import {
  getBillsDirectoryData,
  getBillsSourceLabel,
  isLiveBillsSource,
} from "@/lib/data/bills";
import { getCommitteeSlugLookup } from "@/lib/supabase/bills";
import type { BillStatus } from "@/types/civic";

export const revalidate = 21600;

export default async function BillsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolvedSearchParams = await searchParams;
  const normalizedSearchParams = Object.fromEntries(
    Object.entries(resolvedSearchParams).map(([key, value]) => [
      key,
      Array.isArray(value) ? value[0] : value,
    ]),
  );
  const { bills, source, total, page, pageSize, filters, options, corpus } =
    await getBillsDirectoryData(normalizedSearchParams);
  // Only the committees referenced by the 20 bills on this page, rather than the whole table.
  const committeeSlugs = await getCommitteeSlugLookup(bills).catch(
    () => ({}) as Record<string, string>,
  );
  const live = isLiveBillsSource(source);
  const topicMax = corpus.topTopics[0]?.total ?? 0;

  return (
    <div>
      <PageHeader
        title="Bills Explorer"
        description="Search, filter, and track federal legislation. Politica covers Congress only."
        actions={<SourceBadge label={getBillsSourceLabel(source)} live={live} />}
      />

      <WithRail
        rail={
          <>
            <Card>
              <CardHeader title="The federal corpus" />
              <CardBody>
                <div className="grid grid-cols-2 gap-y-4">
                  <div>
                    <p className="num text-2xl font-semibold tracking-[-0.02em] text-[var(--accent-2)]">
                      {corpus.total.toLocaleString()}
                    </p>
                    <p className="text-[11.5px] text-[var(--faint)]">Bills stored</p>
                  </div>
                  {corpus.byStatus.slice(0, 3).map((row) => (
                    <div key={row.value}>
                      <p
                        className="num text-2xl font-semibold tracking-[-0.02em]"
                        style={{
                          color: TONE_COLOR[BILL_STATUS_TONE[row.value as BillStatus] ?? "slate"],
                        }}
                      >
                        {row.total.toLocaleString()}
                      </p>
                      <p className="text-[11.5px] text-[var(--faint)]">{row.value}</p>
                    </div>
                  ))}
                </div>
              </CardBody>
              <CardNote>Counts cover the whole stored set, not the current filter.</CardNote>
            </Card>

            {corpus.topTopics.length > 0 ? (
              <Card>
                <CardHeader title="Top topics" />
                <CardBody>
                  {corpus.topTopics.map((topic) => (
                    <MeterRow
                      key={topic.value}
                      label={topic.value}
                      icon={<TopicIcon topic={topic.value} />}
                      value={topic.total}
                      max={topicMax}
                      display={topic.total.toLocaleString()}
                    />
                  ))}
                </CardBody>
              </Card>
            ) : null}
          </>
        }
      >
        <BillsDirectory
          bills={bills}
          committeeSlugs={committeeSlugs}
          total={total}
          page={page}
          pageSize={pageSize}
          filters={filters}
          options={options}
        />
      </WithRail>
    </div>
  );
}
