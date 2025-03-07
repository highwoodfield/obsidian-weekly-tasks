import * as lib from "./lib.js";
import test from "node:test";
import * as assert from "assert";
import {DateRange} from "./lib.js";

test("toEpochDate", () => {
	assert.strictEqual(lib.toEpochDate(new Date(Date.UTC(1970, 0, 2))), 1);
	assert.strictEqual(lib.toEpochDate(new Date(Date.UTC(1970, 0, 2, 1))), 1);
})

test("DateRange construct", () => {
	assert.throws(() => {
		new lib.DateRange(new Date(2025, 1, 2), new Date(2025, 1, 1));
	})
	assert.doesNotThrow(() => {
		new lib.DateRange(new Date(2025, 1, 2), new Date(2025, 1, 3));
	})
})

test("DateRange doesInclude Date", () => {
	const range = new DateRange(new Date(2024, 1, 2), new Date(2025, 2, 3));
	assert.strictEqual(range.doesInclude(new Date(2024, 1, 2)), true);
	assert.strictEqual(range.doesInclude(new Date(2024, 1, 1)), false);
	assert.strictEqual(range.doesInclude(new Date(2024, 12, 3)), true);
	assert.strictEqual(range.doesInclude(new Date(2025, 1, 3)), true);
	assert.strictEqual(range.doesInclude(new Date(2025, 2, 4)), false);
})
test("DateRange doesInclude DateRange", () => {
	const range = new DateRange(new Date(2024, 1, 2), new Date(2025, 2, 3));
	const tests = [
		{
			a: new Date(2024, 1, 2),
			b: new Date(2025, 2, 3),
			c: true,
		},
		{
			a: new Date(2024, 1, 10),
			b: new Date(2025, 1, 23),
			c: true
		},
		{
			a: new Date(2024, 0, 10),
			b: new Date(2025, 0, 1),
			c: false
		},
		{
			a: new Date(2024, 10, 10),
			b: new Date(2025, 3, 1),
			c: false
		},
		{
			a: new Date(2023, 0, 1),
			b: new Date(2024, 0, 1),
			c: false
		},
		{
			a: new Date(2025, 8, 8),
			b: new Date(2026, 1, 1),
			c: false
		}
	]
	for (const tcase of tests) {
		assert.strictEqual(range.doesInclude(new DateRange(tcase.a, tcase.b)), tcase.c);
	}
})

test("isTabIndent", () => {
	const tabContent = `# TAB TEST
- list1
\t-list2
\t\tlist3
`;
	const spaceContent = `# SPACE TEST
- list1
  - list2
    -list 3
`;
	assert.strictEqual(lib.isTabIndent(tabContent.split("\n")), true);
	assert.strictEqual(lib.isTabIndent(spaceContent.split("\n")), false);
});
