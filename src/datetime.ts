import moment from "moment/moment";

export function toEpochDate(date: YMD): number {
  return Math.floor(date.toDate().getTime() / (24 * 60 * 60 * 1000));
}

export const DATE_RANGE_DELIMITER = " ~ ";
export const DATE_FORMAT = "YYYY/MM/DD"

export class DateRange {
  from: YMD;
  to: YMD;

  constructor(from: YMD, to: YMD) {
    if (toEpochDate(from) > toEpochDate(to)) {
      throw new Error(`Invalid date range (from: ${from}, to: ${to})`);
    }
    this.from = from;
    this.to = to;
  }

  doesInclude(tgt: YMD | DateRange): boolean {
    if (tgt instanceof YMD) {
      return toEpochDate(this.from) <= toEpochDate(tgt) &&
        toEpochDate(tgt) <= toEpochDate(this.to);
    } else {
      return this.doesInclude(tgt.from) && this.doesInclude(tgt.to);
    }
  }

  equals(another: DateRange): boolean {
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
export class YMD {
  year: number;
  month: number;
  day: number;

  constructor(year: number, month: number, day: number) {
    this.year = year;
    this.month = month;
    this.day = day;
  }

  static today() {
    return this.fromDate(new Date());
  }

  static fromMoment(m: moment.Moment) {
    return this.fromDate(m.toDate());
  }

  static fromDate(m: Date) {
    return new YMD(m.getFullYear(), m.getMonth() + 1, m.getDate());
  }

  toDate() {
    return new Date(this.year, this.month - 1, this.day);
  }

  toString() {
    return moment(this.toDate()).format(DATE_FORMAT);
  }

  /**
   *
   * @param another
   * @return positive value if this object is later than another. Negative if earlier. Zero if equal
   */
  compare(another: YMD): number {
    const y = this.year - another.year;
    if (y !== 0) return y;
    const m = this.month - another.month;
    if (m !== 0) return m;
    return this.day - another.day;
  }

  equals(another: YMD): boolean {
    return this.year === another.year && this.month === another.month && this.day === another.day;
  }

  earlierThan(another: YMD): boolean {
    return this.compare(another) < 0;
  }

  laterThan(another: YMD): boolean {
    return this.compare(another) > 0;
  }
}
