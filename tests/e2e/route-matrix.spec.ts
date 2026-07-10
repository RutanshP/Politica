import { test, expect } from "@playwright/test";

const routes = [
  "/",
  "/analytics",
  "/bills",
  "/committees",
  "/issues",
  "/news",
  "/money",
  "/money/graph",
  "/money/network",
  "/politicians",
  "/profile",
  "/search",
  "/watchlist",
  "/more",
  "/elections",
];

test.describe("route matrix", () => {
  for (const route of routes) {
    test(`loads ${route}`, async ({ page }) => {
      await page.goto(route);
      await expect(page.locator("body")).toBeVisible();
    });
  }
});
