const test = require("node:test");
const assert = require("node:assert/strict");

const jiti = require("../support/jiti.cjs");

const { fetchTopPoliticalArticles } = jiti("@/lib/adapters/newsapi");
const { CORE_NEWS_QUERIES, buildNewsQueries, mentions } = jiti("@/lib/server/news-sync");
const { dedupeByHeadline, summarizeArticleBody } = jiti("@/lib/news-text");

test("buildNewsQueries searches Congress plus the sponsors of the most recently active bills", () => {
  // Stored alphabetically, as listStoredPoliticians returns them -- the old builder searched for
  // the first three names here, which is how the feed filled with one member's local news.
  const politicians = [
    { id: "A1", name: "Aaron Alpha" },
    { id: "B2", name: "Beth Beta" },
    { id: "C3", name: "Cal Gamma" },
  ];
  // Sorted by activity, newest first.
  const bills = [
    { number: "S.9", sponsor_id: "C3" },
    { number: "S.8", sponsor_id: "C3" },
    { number: "HR.7", sponsor_id: "B2" },
    { number: "HR.6", sponsor_id: "A1" },
  ];

  const queries = buildNewsQueries(bills, politicians);

  assert.deepEqual(queries, [...CORE_NEWS_QUERIES, "Cal Gamma", "Beth Beta"]);
  assert.ok(queries.length <= 5, "stays under the rate limit that failed the 8-query runs");
});

test("mentions matches whole terms only, and never a blank one", () => {
  assert.equal(mentions("House passes H.R.1 on a party-line vote", "H.R.1"), true);
  assert.equal(mentions("House passes H.R.1234", "H.R.1"), false);
  assert.equal(mentions("Any headline at all", ""), false);
  assert.equal(mentions("Any headline at all", null), false);
  assert.equal(mentions("Sen. Cal Gamma says...", "cal gamma"), true);
});

test("dedupeByHeadline drops syndicated copies whose URLs differ", () => {
  const kept = dedupeByHeadline([
    { title: "Congress members fleeing DC all say the same thing", url: "https://news.yahoo.com/a" },
    { title: "Congress Members Fleeing DC All Say The Same Thing!", url: "https://uk.news.yahoo.com/a" },
    { title: "A different story", url: "https://example.com/b" },
  ], (item) => item.title);
  assert.deepEqual(kept.map((item) => item.url), ["https://news.yahoo.com/a", "https://example.com/b"]);
});

test("summarizeArticleBody keeps the lede, not the article", () => {
  const body = "Add Yahoo as a preferred source to see more of our stories on Google. "
    + "First sentence of the story is here. ".repeat(40);
  const summary = summarizeArticleBody(body);
  assert.ok(summary.startsWith("First sentence"), summary);
  assert.ok(summary.length <= 420, `summary was ${summary.length} chars`);
  assert.equal(summarizeArticleBody("Short body."), "Short body.");
  assert.equal(summarizeArticleBody(null), "");
});

test("fetchTopPoliticalArticles parses Event Registry article results", async () => {
  process.env.POLITICA_NEWS_API_KEY = "test-key";
  process.env.POLITICA_NEWS_API_BASE_URL = "https://eventregistry.org/api/v1";

  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: true,
    async json() {
      return {
        articles: {
          results: [{
            title: "Budget fight intensifies",
            body: "Leaders traded proposals in Washington.",
            url: "https://example.com/story",
            dateTime: "2026-07-10T12:00:00Z",
            source: {
              title: "Example News",
            },
          }],
        },
      };
    },
  });

  try {
    const articles = await fetchTopPoliticalArticles("budget");
    assert.equal(articles.length, 1);
    assert.equal(articles[0].title, "Budget fight intensifies");
    assert.equal(articles[0].source?.title, "Example News");
  } finally {
    global.fetch = originalFetch;
  }
});
