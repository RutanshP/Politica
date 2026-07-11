const test = require("node:test");
const assert = require("node:assert/strict");

const jiti = require("../support/jiti.cjs");

const { fetchTopPoliticalArticles } = jiti("@/lib/adapters/newsapi");
const { buildNewsQueries } = jiti("@/lib/server/news-sync");

test("buildNewsQueries caps a sync run at 8 queries", () => {
  const bills = Array.from({ length: 5 }, (_, index) => ({
    number: `HR.${index + 1}`,
  }));
  const politicians = Array.from({ length: 5 }, (_, index) => ({
    name: `Politician ${index + 1}`,
  }));
  const issues = Array.from({ length: 4 }, (_, index) => ({
    name: `Issue ${index + 1}`,
  }));

  const queries = buildNewsQueries(bills, politicians, issues);

  assert.equal(queries.length, 8);
  assert.deepEqual(queries, [
    "HR.1",
    "HR.2",
    "HR.3",
    "Politician 1",
    "Politician 2",
    "Politician 3",
    "Issue 1",
    "Issue 2",
  ]);
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
