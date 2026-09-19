/*
 * Names of organizations as the FEC and the LDA file them: usually ALL CAPS, with corporate
 * suffixes and punctuation that vary from one filing to the next for the same organization.
 */

const KEEP_UPPER = new Set([
  "PAC", "PACS", "USA", "US", "LLC", "LLP", "II", "III", "AFL-CIO", "NRA", "NEA", "AFT", "SEIU",
  "UAW", "IBEW", "AT&T", "UPS", "CVS", "BNSF", "COPE", "LP", "PLC", "NA", "AARP", "PBM", "PBMS", "DBA",
]);
const KEEP_LOWER = new Set(["of", "the", "and", "for", "in", "on", "to", "a", "an", "at", "by"]);
// Short words that are English rather than initials, so anything else of three letters or fewer
// stays capitalised as the acronym it almost always is ("CWA", "AFT").
const SHORT_WORDS = new Set([
  "THE", "AND", "FOR", "NEW", "OUR", "ONE", "TWO", "SIX", "TEN", "WAR", "TAX", "AIR", "OIL", "GAS",
  "CAR", "LAW", "ACT", "AID", "ART", "SEA", "SUN", "RED", "WAY", "YES", "ALL", "OUT", "BIG", "FUN",
  "JOB", "PAY", "RUN", "WIN", "YOU", "HER", "HIS", "NOT", "BUT", "CAN", "MAN", "AGE", "END", "ERA",
  "GUN", "KEY", "NET", "TOP", "USE", "VET", "MY", "WE", "NO", "GO", "UP", "IS", "IT", "BE", "OR", "AS",
  "CO", "INC", "ITS", "OAK", "BAY", "SKY", "HUB", "LAB", "FIX", "BOX", "ICE", "EYE", "ARM", "BIO",
]);

/** Title-cases an all-caps filed name, leaving acronyms like PAC alone. Mixed-case names pass through. */
export function tidyOrganizationName(name: string) {
  if (name !== name.toUpperCase()) return name;
  return name
    .toLowerCase()
    .split(/(\s+|[/(),-])/)
    .map((word, index) => {
      const upper = word.toUpperCase();
      if (KEEP_UPPER.has(upper)) return upper;
      // "BANKPAC", "JSTREETPAC": filed as one loud word, kept that way.
      if (/^[A-Z&]{2,}PAC$/.test(upper)) return upper;
      if (index > 0 && KEEP_LOWER.has(word)) return word;
      // No vowels ("DCCC", "NRSC") or a short non-word reads as initials.
      if (/^[A-Z&]{2,}$/.test(upper) && (!/[AEIOUY]/.test(upper) || (upper.length <= 3 && !SHORT_WORDS.has(upper)))) {
        return upper;
      }
      return word.charAt(0).toUpperCase() + word.slice(1);
    })
    .join("")
    .replace(/\bPac\b/g, "PAC")
    .replace(/\bInc\b/g, "Inc")
    .replace(/\bINC\b/g, "Inc");
}

const CORPORATE_SUFFIXES = new Set([
  "inc", "incorporated", "llc", "llp", "lp", "ltd", "limited", "corp", "corporation", "co", "company",
  "plc", "na", "sa", "ag", "nv", "bv", "gmbh", "pc", "pllc", "the",
]);

/**
 * A stable key for one organization across differently-punctuated filings: "Meta Platforms, Inc."
 * and "META PLATFORMS INC" both become "meta-platforms". Used as the lobbying client id in URLs,
 * because the LDA's own client ids are per firm -- a company hired by five firms has five of them.
 */
export function organizationKey(name: string | null | undefined) {
  if (!name) return "";
  const words = name
    .toLowerCase()
    // "(formerly Facebook)", "(on behalf of ...)" describe the filing, not the organization.
    .replace(/\([^)]*\)/g, " ")
    .replace(/&/g, " and ")
    .replace(/['’.]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  while (words.length > 1 && CORPORATE_SUFFIXES.has(words[words.length - 1])) words.pop();
  while (words.length > 1 && words[0] === "the") words.shift();
  return words.join("-").slice(0, 120);
}
