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
export async function fetchBillTextDocument(xmlUrl: string): Promise<BillTextDocument | null> {
  if (!/^https?:\/\/[^ ]+\.xml$/i.test(xmlUrl)) {
    return null;
  }

  try {
    const response = await fetch(xmlUrl, {
      headers: { Accept: "application/xml" },
      // Cached in the Data Cache: the first viewer pays the fetch, everyone else is served the
      // parsed result until revalidation. Tagged so a sync can bust it if needed.
      next: { revalidate: 21600, tags: ["politica:bill-text"] },
    });
    if (!response.ok) return null;

    const xml = await response.text();
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
  } catch {
    return null;
  }
}

interface BillTextVersionLike {
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
