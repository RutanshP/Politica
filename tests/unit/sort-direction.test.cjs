const test = require("node:test");
const assert = require("node:assert/strict");

const jiti = require("../support/jiti.cjs");

const {
  flipSortDirection,
  isNaturalSortDirection,
  naturalSortDirection,
  resolveSortDirection,
  sortDirectionFactor,
  sortDirectionLabel,
} = jiti("@/lib/sort-direction");

test("naturalSortDirection puts quantities best-first and text A to Z", () => {
  assert.equal(naturalSortDirection("Attendance"), "desc");
  assert.equal(naturalSortDirection("Bills introduced"), "desc");
  assert.equal(naturalSortDirection("Active bills"), "desc");
  assert.equal(naturalSortDirection("Candidates"), "desc");
  assert.equal(naturalSortDirection("Name"), "asc");
  assert.equal(naturalSortDirection("Title"), "asc");
  assert.equal(naturalSortDirection("State"), "asc");
  // An option nobody has registered still has to resolve to something usable.
  assert.equal(naturalSortDirection("Something new"), "asc");
});

test("resolveSortDirection honours an explicit direction and ignores junk", () => {
  assert.equal(resolveSortDirection("Attendance", "asc"), "asc");
  assert.equal(resolveSortDirection("Attendance", "desc"), "desc");
  assert.equal(resolveSortDirection("Name", "desc"), "desc");
  // Absent or unparseable values fall back to the option's natural order rather than a
  // fixed default, which is what makes one shared control mean the same thing everywhere.
  assert.equal(resolveSortDirection("Attendance", undefined), "desc");
  assert.equal(resolveSortDirection("Attendance", ""), "desc");
  assert.equal(resolveSortDirection("Attendance", "sideways"), "desc");
  assert.equal(resolveSortDirection("Name", undefined), "asc");
});

test("sortDirectionFactor only reverses a comparator once flipped off natural order", () => {
  assert.equal(sortDirectionFactor("Attendance", "desc"), 1);
  assert.equal(sortDirectionFactor("Attendance", "asc"), -1);
  assert.equal(sortDirectionFactor("Name", "asc"), 1);
  assert.equal(sortDirectionFactor("Name", "desc"), -1);
});

test("sortDirectionFactor flips a natural-order comparator end to end", () => {
  const members = [
    { name: "Alpha", attendance: 71 },
    { name: "Bravo", attendance: 99 },
    { name: "Charlie", attendance: 85 },
  ];
  // The comparator stays written best-first, exactly as the directories keep it.
  const byAttendance = (direction) => {
    const factor = sortDirectionFactor("Attendance", direction);
    return [...members].sort((left, right) => factor * (right.attendance - left.attendance));
  };

  assert.deepEqual(byAttendance("desc").map((m) => m.attendance), [99, 85, 71]);
  assert.deepEqual(byAttendance("asc").map((m) => m.attendance), [71, 85, 99]);
});

test("flipSortDirection and isNaturalSortDirection round-trip", () => {
  assert.equal(flipSortDirection("asc"), "desc");
  assert.equal(flipSortDirection("desc"), "asc");
  assert.equal(isNaturalSortDirection("Attendance", "desc"), true);
  assert.equal(isNaturalSortDirection("Attendance", "asc"), false);
  assert.equal(
    isNaturalSortDirection("Name", flipSortDirection(naturalSortDirection("Name"))),
    false,
  );
});

test("sortDirectionLabel phrases the order for what is being sorted", () => {
  assert.equal(sortDirectionLabel("Recent activity", "desc"), "Newest first");
  assert.equal(sortDirectionLabel("Recent activity", "asc"), "Oldest first");
  assert.equal(sortDirectionLabel("Attendance", "desc"), "Highest first");
  assert.equal(sortDirectionLabel("Attendance", "asc"), "Lowest first");
  assert.equal(sortDirectionLabel("Name", "asc"), "A to Z");
  assert.equal(sortDirectionLabel("Name", "desc"), "Z to A");
});
