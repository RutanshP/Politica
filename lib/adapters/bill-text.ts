import { XMLParser } from "fast-xml-parser";

/**
 * Fetches a bill's official text from its congress.gov document link and parses the structured
 * XML (the "Formatted XML" format) into a section tree the UI can render with real typography.
 *
 * This does NOT use the rate-limited Congress API -- the text lives as a public document on
 * www.congress.gov, so this is a plain cached HTTP GET of that file.
 */

export interface BillTextNode {
  id: string;
  enum?: string; // "1.", "(a)", "(1)"
  header?: string; // "Short title"
  text: string; // flattened inline text for this node (excludes children)
  level: number;
  /** True for text inside a <quoted-block> -- statutory language a bill inserts into existing law. */
  quoted?: boolean;
  children: BillTextNode[];
}

export interface BillTextDocument {
  officialTitle?: string;
  nodes: BillTextNode[];
  charCount: number;
  sectionCount: number;
}

// Every structural container that can nest. Small bills start at `section`; large bills nest
// sections inside division/title/subtitle/part/chapter. Depth (not the tag) drives indentation.
const STRUCTURAL_TAGS = new Set([
  "division",
  "title",
  "subtitle",
  "part",
  "subpart",
  "chapter",
  "subchapter",
  "section",
  "subsection",
  "paragraph",
  "subparagraph",
  "clause",
  "subclause",
  "item",
  "subitem",
]);

// Inline elements that appear inside <text>; we keep their text, dropping the tag.
const QUOTE_TAGS = new Set(["quote"]);

type OrderedNode = Record<string, unknown> & { ":@"?: Record<string, string>; "#text"?: unknown };

function tagOf(node: OrderedNode): string | undefined {
  return Object.keys(node).find((key) => key !== ":@" && key !== "#text");
}

function childrenOf(node: OrderedNode, tag: string): OrderedNode[] {
  const value = node[tag];
  return Array.isArray(value) ? (value as OrderedNode[]) : [];
}

/** Flattens the mixed content of a node (text interleaved with inline tags like <quote>). */
function flattenInline(nodes: OrderedNode[]): string {
  let out = "";
  for (const node of nodes) {
    if ("#text" in node && node["#text"] != null) {
      out += String(node["#text"]);
      continue;
    }
    const tag = tagOf(node);
    if (!tag) continue;
    const inner = flattenInline(childrenOf(node, tag));
    // GPO bill text wraps quoted amendment language in “curly” quotes.
    out += QUOTE_TAGS.has(tag) ? `“${inner}”` : inner;
  }
  return out;
}

function findBody(nodes: OrderedNode[]): OrderedNode[] | null {
  for (const node of nodes) {
    const tag = tagOf(node);
    if (!tag) continue;
    if (/-body$/i.test(tag) || tag === "legis-body" || tag === "resolution-body") {
      return childrenOf(node, tag);
    }
    const nested = findBody(childrenOf(node, tag));
    if (nested) return nested;
  }
  return null;
}

function findOfficialTitle(nodes: OrderedNode[]): string | undefined {
  for (const node of nodes) {
    const tag = tagOf(node);
    if (!tag) continue;
    if (tag === "official-title") {
      return flattenInline(childrenOf(node, tag)).trim() || undefined;
    }
    const nested = findOfficialTitle(childrenOf(node, tag));
    if (nested) return nested;
  }
  return undefined;
}

let sequentialId = 0;

/**
 * A <quoted-block> holds the statutory text a bill inserts (its structural children are the real
 * sections/subsections being added). Returns those children, flagged `quoted` so the UI can set
 * them off visually, plus any bare quoted text.
 */
function buildQuotedBlock(node: OrderedNode, level: number): BillTextNode[] {
  const out: BillTextNode[] = [];
  for (const child of childrenOf(node, "quoted-block")) {
    const childTag = tagOf(child);
    if (!childTag) continue;
    if (STRUCTURAL_TAGS.has(childTag)) {
      const built = buildNode(child, childTag, level);
      markQuoted(built);
      out.push(built);
    } else if (childTag === "text") {
      const text = flattenInline(childrenOf(child, "text")).replace(/\s+/g, " ").trim();
      if (text) out.push({ id: `n${sequentialId++}`, text, level, quoted: true, children: [] });
    }
  }
  return out;
}

function markQuoted(node: BillTextNode) {
  node.quoted = true;
  node.children.forEach(markQuoted);
}

/** Turns one structural element into a normalized node with children; `level` is nesting depth. */
function buildNode(node: OrderedNode, tag: string, level: number): BillTextNode {
  const kids = childrenOf(node, tag);

  let enumValue: string | undefined;
  let header: string | undefined;
  const inlineParts: OrderedNode[] = [];
  const children: BillTextNode[] = [];

  for (const child of kids) {
    const childTag = tagOf(child);
    if (!childTag) {
      if ("#text" in child) inlineParts.push(child);
      continue;
    }
    if (childTag === "enum") {
      enumValue = flattenInline(childrenOf(child, "enum")).trim() || undefined;
    } else if (childTag === "header") {
      header = flattenInline(childrenOf(child, "header")).trim() || undefined;
    } else if (childTag === "text") {
      inlineParts.push(...childrenOf(child, "text"));
    } else if (childTag === "quoted-block") {
      // The actual statutory language a bill inserts into existing law lives here. Without this
      // the page shows "by inserting the following:" but not the text being inserted.
      children.push(...buildQuotedBlock(child, level + 1));
    } else if (STRUCTURAL_TAGS.has(childTag)) {
      children.push(buildNode(child, childTag, level + 1));
    }
  }

  return {
    id: `n${sequentialId++}`,
    enum: enumValue,
    header,
    text: flattenInline(inlineParts).replace(/\s+/g, " ").trim(),
    level,
    children,
  };
}

function countChars(nodes: BillTextNode[]): number {
  return nodes.reduce(
    (sum, node) => sum + node.text.length + (node.header?.length || 0) + countChars(node.children),
    0,
  );
}

/**
 * @param xmlUrl the "Formatted XML" document URL stored on the bill version.
 * @returns the parsed document, or null if the fetch/parse failed (caller falls back to the link).
 */
const BILL_TEXT_FETCH_TIMEOUT_MS = 10_000;
const BILL_TEXT_FETCH_ATTEMPTS = 3;

async function fetchBillTextXml(xmlUrl: string, bypassCache: boolean) {
  for (let attempt = 1; attempt <= BILL_TEXT_FETCH_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(xmlUrl, {
        headers: {
          Accept: "application/xml",
          // The default runtime User-Agent is a common trigger for upstream throttling.
          "User-Agent": "Politica/1.0 (civic data viewer)",
        },
        // Without a timeout a hung upstream blocks the whole render.
        signal: AbortSignal.timeout(BILL_TEXT_FETCH_TIMEOUT_MS),
        ...(bypassCache
          ? { cache: "no-store" as const }
          : {
              // Cached in the Data Cache: the first viewer pays the fetch, everyone else is served
              // the parsed result until revalidation. Tagged so a sync can bust it if needed.
              next: { revalidate: 21600, tags: ["politica:bill-text"] },
            }),
      });

      // 4xx is a real answer -- retrying will not change it. Only retry transport errors and 5xx.
      if (response.ok) return await response.text();
      if (response.status >= 400 && response.status < 500) return null;
    } catch {
      // Timeout or transport failure; fall through to the retry.
    }

    if (attempt < BILL_TEXT_FETCH_ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, 300 * attempt));
    }
  }

  return null;
}

function parseBillTextXml(xml: string): BillTextDocument | null {
  const parser = new XMLParser({ ignoreAttributes: true, preserveOrder: true, trimValues: false });
  const tree = parser.parse(xml) as OrderedNode[];

  const body = findBody(tree);
  if (!body) return null;

  sequentialId = 0;
  const nodes: BillTextNode[] = [];
  for (const node of body) {
    const tag = tagOf(node);
    if (tag && STRUCTURAL_TAGS.has(tag)) {
      nodes.push(buildNode(node, tag, 0));
    }
  }

  if (nodes.length === 0) return null;

  return {
    officialTitle: findOfficialTitle(tree),
    nodes,
    charCount: countChars(nodes),
    sectionCount: nodes.length,
  };
}

export async function fetchBillTextDocument(xmlUrl: string): Promise<BillTextDocument | null> {
  if (!/^https?:\/\/[^ ]+\.xml$/i.test(xmlUrl)) {
    return null;
  }

  try {
    const cached = await fetchBillTextXml(xmlUrl, false);
    const parsed = cached ? parseBillTextXml(cached) : null;
    if (parsed) return parsed;

    /*
     * The cached response was missing or did not parse as bill XML. congress.gov answers
     * throttling and error pages with a 200, and Next caches a 200 for the full revalidate window
     * -- so one bad response poisoned this URL for six hours and the tab read "Inline text
     * unavailable" even though the document was fine. Bypass the cache once before giving up.
     */
    const fresh = await fetchBillTextXml(xmlUrl, true);
    return fresh ? parseBillTextXml(fresh) : null;
  } catch {
    return null;
  }
}

interface BillTextVersionLike {
  id?: string;
  label: string;
  date?: string;
  sourceUrl?: string;
  formats?: Array<{ type?: string; url?: string }>;
}

/** The bill-DTD "Formatted XML" url for a single version, or undefined. */
function billDtdXmlUrl(version: BillTextVersionLike) {
  return (version.formats || [])
    .map((format) => format.url)
    .filter((url): url is string => Boolean(url))
    .find((url) => url.toLowerCase().endsWith(".xml") && !url.toLowerCase().includes("_uslm"));
}

// Prefer the most authoritative *complete* text. "Public Law" is the final text but ships only
// USLM (skipped), so "Enrolled" is the best bill-DTD option. "Engrossed Amendment" versions are
// amendment blocks, not the full titled bill, so they rank low.
function versionScore(label: string) {
  const l = label.toLowerCase();
  if (l.includes("enrolled")) return 100;
  if (l.includes("public law")) return 95;
  if (l.includes("engrossed amendment")) return 40; // amendment block, not the full bill
  if (l.includes("engrossed")) return 80;
  if (l.includes("placed on calendar")) return 70;
  if (l.includes("reported")) return 60;
  if (l.includes("referred")) return 50;
  if (l.includes("introduced")) return 45;
  return 55;
}

/**
 * Chooses which version's text to display. The very latest version can be a "Public Law" that
 * ships only USLM markup (a schema this parser does not target), or an amendment block. So among
 * the versions that have a bill-DTD Formatted XML, we pick the most authoritative complete text
 * (Enrolled first); failing that, we derive an .xml sibling from a version's .htm source url.
 */
export function pickBillTextSource(versions: BillTextVersionLike[]): { url: string; version: BillTextVersionLike } | null {
  const candidates = versions
    .map((version) => ({ version, url: billDtdXmlUrl(version) }))
    .filter((candidate): candidate is { version: BillTextVersionLike; url: string } => Boolean(candidate.url))
    .sort((left, right) => versionScore(right.version.label) - versionScore(left.version.label));

  if (candidates[0]) {
    return { url: candidates[0].url, version: candidates[0].version };
  }

  const derivable = versions.find((version) => version.sourceUrl?.toLowerCase().endsWith(".htm"));
  if (derivable) {
    return { url: derivable.sourceUrl!.replace(/\.htm$/i, ".xml"), version: derivable };
  }

  return null;
}

/** The readable-text url for one specific version, by the same two routes pickBillTextSource uses. */
export function billTextSourceForVersion(version: BillTextVersionLike) {
  const xml = billDtdXmlUrl(version);
  if (xml) return { url: xml, version };

  const htm = version.sourceUrl?.toLowerCase().endsWith(".htm") ? version.sourceUrl : undefined;
  return htm ? { url: htm.replace(/\.htm$/i, ".xml"), version } : null;
}

/**
 * Which version the Text tab should show: the one asked for, else the default pick.
 *
 * The tab used to render pickBillTextSource's choice and nothing else, so a bill with nine stored
 * versions -- Introduced, Reported, Engrossed, Enrolled, Public Law -- showed one of them with no
 * way to read any other, even though every version has its own document link. Falls back rather
 * than 404s on an unknown or textless id: a stale link should still land on readable text.
 */
export function resolveBillTextSource(
  versions: BillTextVersionLike[],
  requestedVersionId?: string,
) {
  if (requestedVersionId) {
    const requested = versions.find((version) => version.id === requestedVersionId);
    const source = requested ? billTextSourceForVersion(requested) : null;
    if (source) return source;
  }

  return pickBillTextSource(versions);
}

// orderBillTextVersions and hasReadableBillText were written for the standalone Text tab's chip
// row. That tab folded into Version Details, where lib/bill-versions.ts orders bill texts together
// with amendments in one list, so both were left with no callers and removed.
