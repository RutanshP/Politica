const test = require("node:test");
const assert = require("node:assert/strict");

const jiti = require("../support/jiti.cjs");

const {
  classifySource,
  collectSources,
  findBothSides,
  stackBand,
  topSourcesWithRemainder,
} = jiti("@/lib/graph/money-flow-model");

const node = (id, entityType, label, extra = {}) => ({
  id,
  data: { label, entityType, ...extra },
});

const edge = (id, source, target, relationshipType, amount, extra = {}) => ({
  id,
  source,
  target,
  data: { relationshipType, label: relationshipType, amount, isAggregate: false, sourceCount: 0, ...extra },
});

test("classifySource reads independent spending off the edge, not the spender", () => {
  // A PAC making an independent expenditure is outside money, not a contribution to the member.
  assert.deepEqual(
    classifySource(edge("e", "s", "t", "independent_spending_support", 10), "pac"),
    { kind: "outside", isOpposition: false },
  );
  assert.deepEqual(
    classifySource(edge("e", "s", "t", "independent_spending_oppose", 10), "pac"),
    { kind: "outside", isOpposition: true },
  );
});

test("classifySource treats employee-reported giving as employer money whatever the entity is", () => {
  assert.equal(classifySource(edge("e", "s", "t", "employee_contributions", 10), "donorAggregate").kind, "employer");
  assert.equal(classifySource(edge("e", "s", "t", "contributed_to", 10), "employer").kind, "employer");
});

test("classifySource ignores relationships that are not money", () => {
  assert.equal(classifySource(edge("e", "s", "t", "affiliated_with", 0), "candidateCommittee"), null);
  assert.equal(classifySource(edge("e", "s", "t", "retained", 500), "lobbyingFirm"), null);
});

test("collectSources sums repeat edges from one source and drops zero-amount ones", () => {
  const graph = {
    nodes: [node("emp-acme", "employer", "ACME CORP"), node("cmte", "candidateCommittee", "FRIENDS OF X")],
    edges: [
      edge("a", "emp-acme", "cmte", "employee_contributions", 4000),
      edge("b", "emp-acme", "cmte", "employee_contributions", 1500),
      edge("c", "emp-acme", "cmte", "employee_contributions", 0),
    ],
  };
  const sources = collectSources(graph);
  assert.equal(sources.length, 1);
  assert.equal(sources[0].amount, 5500);
  assert.equal(sources[0].kind, "employer");
});

test("collectSources keeps support and opposition from one group as separate rows", () => {
  const graph = {
    nodes: [node("ie", "independentExpenditureGroup", "BIG SPEND PAC"), node("cmte", "candidateCommittee", "FRIENDS OF X")],
    edges: [
      edge("a", "ie", "cmte", "independent_spending_support", 900),
      edge("b", "ie", "cmte", "independent_spending_oppose", 250),
    ],
  };
  const sources = collectSources(graph);
  assert.equal(sources.length, 2);
  assert.equal(sources.find((s) => s.isOpposition).amount, 250);
  assert.equal(sources.find((s) => !s.isOpposition).amount, 900);
});

test("collectSources carries the methodology note through", () => {
  const graph = {
    nodes: [
      node("emp", "employer", "ACME CORP", {
        isAggregate: true,
        metadata: { methodology: "Grouped by contributor-reported employer." },
      }),
      node("cmte", "candidateCommittee", "FRIENDS OF X"),
    ],
    edges: [edge("a", "emp", "cmte", "employee_contributions", 100)],
  };
  assert.match(collectSources(graph)[0].methodology, /contributor-reported employer/);
});

test("topSourcesWithRemainder folds what it cannot draw into one honest band", () => {
  const sources = [500, 400, 300, 200, 100].map((amount, i) => ({ id: `s${i}`, amount }));
  const { shown, remainder } = topSourcesWithRemainder(sources, 3);
  assert.equal(shown.length, 3);
  assert.equal(remainder.count, 2);
  assert.equal(remainder.amount, 300);
});

test("topSourcesWithRemainder leaves a short list alone", () => {
  const sources = [{ id: "a", amount: 1 }, { id: "b", amount: 2 }];
  const { shown, remainder } = topSourcesWithRemainder(sources, 8);
  assert.equal(shown.length, 2);
  assert.equal(remainder.count, 0);
  assert.equal(remainder.amount, 0);
});

test("findBothSides matches an FEC employer string to an LDA client name", () => {
  const sources = collectSources({
    nodes: [node("emp", "employer", "META PLATFORMS INC"), node("cmte", "candidateCommittee", "FRIENDS OF X")],
    edges: [edge("a", "emp", "cmte", "employee_contributions", 7000)],
  });
  const both = findBothSides(sources, [
    { billId: "hr-1-119", number: "HR.1", href: "/bills/hr-1-119", clientKeys: ["meta-platforms"] },
  ]);
  assert.equal(both.length, 1);
  assert.equal(both[0].name, "META PLATFORMS INC");
  assert.equal(both[0].amount, 7000);
  assert.deepEqual(both[0].bills.map((b) => b.number), ["HR.1"]);
});

test("findBothSides never counts money spent against the member as funding them", () => {
  const sources = collectSources({
    nodes: [node("ie", "independentExpenditureGroup", "ACME CORP"), node("cmte", "candidateCommittee", "FRIENDS OF X")],
    edges: [edge("a", "ie", "cmte", "independent_spending_oppose", 9000)],
  });
  const both = findBothSides(sources, [
    { billId: "hr-1-119", number: "HR.1", href: "/bills/hr-1-119", clientKeys: ["acme"] },
  ]);
  assert.deepEqual(both, []);
});

test("findBothSides collects every bill one organization lobbied, without repeats", () => {
  const sources = collectSources({
    nodes: [node("emp", "employer", "ACME CORP"), node("cmte", "candidateCommittee", "FRIENDS OF X")],
    edges: [edge("a", "emp", "cmte", "employee_contributions", 100)],
  });
  const both = findBothSides(sources, [
    { billId: "hr-1-119", number: "HR.1", href: "/a", clientKeys: ["acme", "acme"] },
    { billId: "s-2-119", number: "S.2", href: "/b", clientKeys: ["acme"] },
  ]);
  assert.equal(both.length, 1);
  assert.deepEqual(both[0].bills.map((b) => b.number), ["HR.1", "S.2"]);
});

test("stackBand fills the band and leaves exactly one gap between rows", () => {
  const boxes = stackBand([100, 100], { height: 210, gap: 10, minHeight: 8 });
  assert.equal(boxes.length, 2);
  assert.equal(boxes[0].y, 0);
  assert.equal(Math.round(boxes[0].height), 100);
  assert.equal(Math.round(boxes[1].y), 110);
  assert.equal(Math.round(boxes[1].y + boxes[1].height), 210);
});

test("stackBand gives a tiny row a usable height instead of a hairline", () => {
  const boxes = stackBand([10000, 1], { height: 200, gap: 4, minHeight: 12 });
  assert.ok(boxes[1].height >= 12, `tiny row was ${boxes[1].height}px`);
});

test("stackBand divides evenly when there is no money at all", () => {
  const boxes = stackBand([0, 0, 0], { height: 100, gap: 5, minHeight: 10 });
  const heights = boxes.map((b) => Math.round(b.height));
  assert.deepEqual(heights, [30, 30, 30]);
});

test("stackBand handles an empty band", () => {
  assert.deepEqual(stackBand([], { height: 100, gap: 5, minHeight: 10 }), []);
});
