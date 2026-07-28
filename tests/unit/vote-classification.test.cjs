const test = require("node:test");
const assert = require("node:assert/strict");

const jiti = require("../support/jiti.cjs");

const { classifyVote, isSubstantiveVote } = jiti("@/lib/vote-classification");

test("classifyVote reads the Senate's 'Confirmation:' phrasing as a nomination", () => {
  // Verbatim titles from the stored Senate vote set. None contain the word "nomination", and the
  // state follows the name rather than the noun, so "confirmation of" never matched.
  assert.equal(
    classifyVote("Confirmation: Maria A. Lanahan, of Missouri, to be U.S. District Judge for the Eastern District of Missouri"),
    "nomination",
  );
  assert.equal(
    classifyVote("Confirmation: Robert Law, of the District of Columbia, to be Under Secretary for Strategy, Policy, and Plans, Department of Homeland Security"),
    "nomination",
  );
  assert.equal(
    classifyVote("Confirmation: Edward L. Artau of Florida, to be United States District Judge for the Southern District of Florida"),
    "nomination",
  );
});

test("classifyVote treats a PN-numbered vote as a nomination however it is worded", () => {
  assert.equal(classifyVote("Some unforeseen motion text", { billNumber: "PN 150-4" }), "nomination");
  assert.equal(classifyVote("Some unforeseen motion text", { billNumber: "PN 346-3" }), "nomination");
  // A real bill number must not be dragged in by the same rule.
  assert.equal(classifyVote("National Defense Authorization Act", { billNumber: "S.2296" }), "policy");
  assert.equal(classifyVote("A bill to do something", { billNumber: "PNC.12" }), "policy");
});

test("classifyVote reads a procedural motion stated only in the result", () => {
  // The title is the bare Act name; nothing but the result says this was a motion to proceed.
  assert.equal(
    classifyVote("National Defense Authorization Act for Fiscal Year 2026", {
      billNumber: "S.2296",
      result: "Motion to Proceed Agreed to",
    }),
    "procedural",
  );
  assert.equal(classifyVote("Some Act", { result: "Motion to Table Agreed to" }), "procedural");
  assert.equal(classifyVote("Some Act", { result: "Cloture on the Motion to Proceed Rejected" }), "procedural");
  assert.equal(classifyVote("Some Act", { result: "Motion to Discharge Rejected" }), "procedural");
  assert.equal(classifyVote("Some Act", { result: "Point of Order Well Taken" }), "procedural");
});

test("classifyVote leaves an unnamed motion result alone", () => {
  // "Motion Rejected" names no motion, so it is not evidence of anything.
  assert.equal(classifyVote("Some Act", { result: "Motion Rejected" }), "policy");
  assert.equal(classifyVote("Some Act", { result: "Motion Agreed to" }), "policy");
});

test("classifyVote still reads passage of a bill as policy", () => {
  assert.equal(
    classifyVote("Continuing Appropriations, Agriculture, Legislative Branch, Military Construction and Veterans Affairs, and Extensions Act, 2026", {
      billNumber: "HR.5371",
      result: "Bill Defeated",
    }),
    "policy",
  );
  assert.equal(classifyVote("Illegitimate Court Counteraction Act", { billNumber: "HR.23", result: "Bill Passed" }), "policy");
  assert.equal(classifyVote("Some Act", { result: "Joint Resolution Passed" }), "policy");
});

test("classifyVote keeps procedural ahead of nomination for a cloture motion on a nominee", () => {
  assert.equal(
    classifyVote("Motion to Invoke Cloture: Robert Law to be Under Secretary for Strategy, Policy, and Plans, Department of Homeland Security", {
      billNumber: "PN 129-10",
      result: "Cloture Motion Agreed to",
    }),
    "procedural",
  );
});

test("classifyVote is unchanged by an absent context", () => {
  assert.equal(classifyVote("Motion to proceed to H.R. 1"), "procedural");
  assert.equal(classifyVote("Providing for consideration of H.R. 1"), "procedural");
  assert.equal(classifyVote("Amendment No. 4 to H.R. 1"), "amendment");
  assert.equal(classifyVote("Illegitimate Court Counteraction Act"), "policy");
  assert.equal(classifyVote(null), "policy");
  assert.equal(classifyVote(undefined), "policy");
});

test("a confirmation and a motion to proceed are both kept out of the policy list", () => {
  assert.equal(isSubstantiveVote(classifyVote("Confirmation: Maria A. Lanahan, of Missouri, to be U.S. District Judge")), false);
  assert.equal(
    isSubstantiveVote(classifyVote("National Defense Authorization Act for Fiscal Year 2026", { result: "Motion to Proceed Agreed to" })),
    false,
  );
  assert.equal(isSubstantiveVote(classifyVote("Illegitimate Court Counteraction Act", { result: "Bill Passed" })), true);
});
