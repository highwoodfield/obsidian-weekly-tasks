import moment from "moment/moment.js";

const WEEK_BEGIN_DAY = 1; // 1 for monday
const WEEK_END_DAY = 0; // 0 for monday

export function toEpochDate(date: YMD): number {
  return Math.floor(date.toDate().getTime() / (24 * 60 * 60 * 1000));
}

export const DATE_RANGE_DELIMITER = " ~ ";
export const DATE_FORMAT = "YYYY/MM/DD"

export abstract class Temporal {
  abstract getDate(): YMD;

  abstract equals(another: Temporal): boolean;

  abstract toString(): string;

  compareTemporal(another: Temporal): number {
    return this.getDate().compare(another.getDate());
  }
}

export class DateRange extends Temporal {
  from: YMD;
  to: YMD;

  constructor(from: YMD, to: YMD) {
    super();
    if (toEpochDate(from) > toEpochDate(to)) {
      throw new Error(`Invalid date range (from: ${from}, to: ${to})`);
    }
    this.from = from;
    this.to = to;
  }

  static fromString(s: string): DateRange | string {
    const dates: YMD[] = [];
    for (const rawDate of s.split(DATE_RANGE_DELIMITER)) {
      const m = moment(rawDate, DATE_FORMAT);
      if (!m.isValid()) {
        return "Invalid date format";
      }
      dates.push(YMD.fromMoment(m));
    }
    if (dates.length !== 2) {
      return "Invalid length of data: " + dates.length;
    }
    try {
      return new DateRange(dates[0], dates[1]);
    } catch (e) {
      return "Invalid range";
    }
  }

  doesInclude(tgt: YMD | DateRange): boolean {
    if (tgt instanceof YMD) {
      return toEpochDate(this.from) <= toEpochDate(tgt) &&
        toEpochDate(tgt) <= toEpochDate(this.to);
    } else {
      return this.doesInclude(tgt.from) && this.doesInclude(tgt.to);
    }
  }

  getDate(): YMD {
    return this.from;
  }

  equals(another: Temporal): boolean {
    if (!(another instanceof DateRange)) {
      return false;
    }
    return this.from.equals(another.from) && this.to.equals(another.to);
  }

  toString() {
    return this.from.toString() + DATE_RANGE_DELIMITER + this.to.toString();
  }
}

export function* genDates(from: YMD, to: YMD) {
  const earliestDate = from.toDate();
  const currentDate = new Date(earliestDate);
  let currentYMD = YMD.fromDate(currentDate);
  while (currentYMD.earlierThan(to) || currentYMD.equals(to)) {
    yield currentYMD;

    currentDate.setDate(currentDate.getDate() + 1);
    currentYMD = YMD.fromDate(currentDate);
  }
}

/**
 * Local Time Zone.
 */
export class YMD extends Temporal {
  year: number;
  month: number; // 1 ~ 12
  day: number;

  constructor(year: number, month: number, day: number) {
    super();
    this.year = year;
    this.month = month;
    this.day = day;
  }

  static today() {
    return this.fromDate(new Date());
  }

  static fromString(s: string): YMD | undefined {
    const m = moment(s, DATE_FORMAT, true);
    if (!m.isValid()) return undefined;
    return YMD.fromMoment(m);
  }

  static fromMoment(m: moment.Moment) {
    return this.fromDate(m.toDate());
  }

  static fromDate(m: Date) {
    return new YMD(m.getFullYear(), m.getMonth() + 1, m.getDate());
  }

  plusDays(days: number): YMD {
    const d = this.toDate();
    d.setDate(d.getDate() + days);
    return YMD.fromDate(d);
  }

  toDate() {
    return new Date(this.year, this.month - 1, this.day);
  }

  getDate(): YMD {
    return this;
  }

  toString() {
    return moment(this.toDate()).format(DATE_FORMAT);
  }

  /**
   *
   * @param another
   * @return positive value if "this" is later than another. Negative if earlier. Zero if equal
   */
  compare(another: YMD): number {
    const y = this.year - another.year;
    if (y !== 0) return y;
    const m = this.month - another.month;
    if (m !== 0) return m;
    return this.day - another.day;
  }

  equals(another: Temporal): boolean {
    if (!(another instanceof YMD)) {
      return false;
    }
    return this.year === another.year && this.month === another.month && this.day === another.day;
  }

  earlierThan(another: YMD): boolean {
    return this.compare(another) < 0;
  }

  laterThan(another: YMD): boolean {
    return this.compare(another) > 0;
  }
}


// 始まる曜日が定まっているDateRange。ちゃんとそのあたり検証してくれるし、あるYMDからWeekを出してくれたりもする。
export class Week {
  readonly range: DateRange;

  constructor(range: DateRange) {
    if (!Week.isWeekRange(range)) {
      throw new Error("Illegal range: " + range.toString())
    }
    this.range = range;
  }

  static fromYMD(date: YMD) {
    let beginOfWeekDate = date.toDate();
    while (beginOfWeekDate.getDay() !== WEEK_BEGIN_DAY) {
      beginOfWeekDate.setDate(beginOfWeekDate.getDate() - 1);
    }
    const beginOfWeek = YMD.fromDate(beginOfWeekDate);
    const endOfWeek = beginOfWeek.plusDays(6);
    return new Week(new DateRange(beginOfWeek, endOfWeek));
  }

  static isBeginOfWeek(date: YMD) {
    return date.toDate().getDay() === WEEK_BEGIN_DAY;
  }

  static fromRange(range: DateRange): Week | undefined {
    return this.isWeekRange(range)
      ? new Week(range)
      : undefined;
  }

  static isWeekRange(range: DateRange) {
    if (range.from.toDate().getDay() !== WEEK_BEGIN_DAY) {
      return false;
    }
    const endOfWeek = range.from.plusDays(6);
    return range.to.equals(endOfWeek);
  }
}
