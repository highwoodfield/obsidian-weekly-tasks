import * as dt from "./datetime";
import test from "node:test";
import {deepStrictEqual} from "node:assert";
import * as a from "assert";
import {DateRange, Week, YMD} from "./datetime.js";

test("Week#constructor", t => {
  a.doesNotThrow(() => {
    new Week(new DateRange(
      new YMD(2025, 4, 28),
      new YMD(2025, 5, 4)
    ));
  })
  a.throws(() => {
    new Week(new DateRange(
      new YMD(2025, 4, 27),
      new YMD(2025, 5, 1)
    ));
  })
})

test("Week#fromYMD", () => {
  const week = new Week(new DateRange(
    new YMD(2025, 4, 28),
    new YMD(2025, 5, 4)
  ));
  a.notDeepStrictEqual(
    Week.fromYMD(new YMD(2025, 4, 27)),
    week
  );
  deepStrictEqual(
    Week.fromYMD(new YMD(2025, 4, 28)),
    week
  );
  deepStrictEqual(
    Week.fromYMD(new YMD(2025, 5, 4)),
    week
  );
  deepStrictEqual(
    Week.fromYMD(new YMD(2025, 4, 29)),
    week
  );
})

test("Week#isWeekRange", () => {
  deepStrictEqual(
    Week.isWeekRange(
      new DateRange(
        new YMD(2025, 4, 28),
        new YMD(2025, 5, 4),
      )
    ),
    true
  );
  deepStrictEqual(
    Week.isWeekRange(
      new DateRange(
        new YMD(2025, 4, 27),
        new YMD(2025, 5, 4),
      )
    ),
    false
  );
  deepStrictEqual(
    Week.isWeekRange(
      new DateRange(
        new YMD(2025, 4, 28),
        new YMD(2025, 5, 3),
      )
    ),
    false
  );
});
