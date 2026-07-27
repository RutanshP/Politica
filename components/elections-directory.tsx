"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { Badge, Tag } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { FilterRow, FilterSelect } from "@/components/ui/filter-select";
import { ListRow } from "@/components/ui/list-row";
import { Tabs } from "@/components/ui/tabs";
import { partyTone } from "@/components/ui/tones";
import type { ElectionOffice, ElectionRace } from "@/types/civic";

const OFFICE_TABS: Array<{ office: ElectionOffice; label: string }> = [
  { office: "P", label: "President" },
  { office: "S", label: "Senate" },
  { office: "H", label: "House" },
];

function isDefaultValue(key: string, value: string) {
  return !value || value.startsWith("All ");
}

export function ElectionsDirectory({
  races,
  filters,
  options,
}: {
  races: ElectionRace[];
  filters: {
    office: ElectionOffice;
    state: string;
    party: string;
    sortBy: string;
  };
  options: {
    states: string[];
    parties: string[];
  };
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function updateParams(updates: Record<string, string>) {
    const params = new URLSearchParams(searchParams.toString());
    Object.entries(updates).forEach(([key, value]) => {
      if (isDefaultValue(key, value)) {
        params.delete(key);
      } else {
        params.set(key, value);
      }
    });
    router.push(params.toString() ? `${pathname}?${params.toString()}` : pathname);
  }

  const showStateFilter = filters.office !== "P";
  const filterChips = [
    ...(showStateFilter
      ? [{ key: "state", label: "State", value: filters.state, options: options.states }]
      : []),
    { key: "party", label: "Party", value: filters.party, options: options.parties },
    { key: "sort", label: "Sort by", value: filters.sortBy, options: ["State", "Candidates"] },
  ];

  return (
    <div className="flex flex-col gap-3.5">
      <Tabs
        items={OFFICE_TABS.map(({ office, label }) => ({
          label,
          href: `${pathname}?office=${office}`,
          active: filters.office === office,
        }))}
      />

      <FilterRow>
        {filterChips.map((chip) => (
          <FilterSelect
            key={chip.key}
            label={chip.label}
            value={chip.value}
            options={chip.options}
            active={!isDefaultValue(chip.key, chip.value)}
            onChange={(value) => updateParams({ [chip.key]: value })}
          />
        ))}
      </FilterRow>

      {races.length === 0 ? (
        <Card>
          <CardBody>
            <p className="py-8 text-center text-[13px] text-[var(--muted)]">
              No candidates match these filters yet.
            </p>
          </CardBody>
        </Card>
      ) : (
        <div className="grid gap-3.5 lg:grid-cols-2">
          {races.map((race) => (
            <Card key={race.id}>
              <CardHeader
                title={
                  race.office === "P"
                    ? `President · ${race.electionYear}`
                    : `${race.state}${race.district ? `-${race.district}` : ""} · ${race.officeFull} · ${race.electionYear}`
                }
                count={race.candidates.length}
              />
              <CardBody tight>
                {race.candidates.map((candidate) => (
                  <ListRow
                    key={candidate.id}
                    href={candidate.politicianSlug ? `/politicians/${candidate.politicianSlug}` : undefined}
                    title={candidate.name}
                    subtitle={candidate.candidateStatus === "C" ? "Active candidate" : undefined}
                    trailing={
                      <span className="flex items-center gap-1.5">
                        {candidate.incumbentChallenge ? (
                          <Tag>{candidate.incumbentChallengeFull}</Tag>
                        ) : null}
                        <Badge tone={partyTone(candidate.party)}>{candidate.party}</Badge>
                      </span>
                    }
                  />
                ))}
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
