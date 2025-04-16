import moment from "moment";
import {DATE_FORMAT, DATE_RANGE_DELIMITER, DateRange, genDates, YMD} from "./datetime";
import * as md from "./md";
import {MDListNode, MDListRootNode, SourceFile} from "./md";

const WEEK_BEGIN_DAY = 1; // 1 for monday
const WEEK_END_DAY = 0; // 0 for monday

export class MalformedMD {
  reason: string;
  node: MDListNode;

  constructor(reason: string, node: MDListNode) {
    this.reason = reason;
    this.node = node;
  }

  toString() {
    return `${this.node.srcFile}: Malformed because: ${this.reason}`;
  }
}

export function isTabIndent(lines: string[]) {
  return lines.find((line) => line.startsWith('\t')) !== undefined;
}

/**
 * Returns undefined when there is no tasks in the content.
 *
 * @param srcFile
 * @param content
 */
export function parseContentToTasks(srcFile: SourceFile, content: string): Tasks | undefined {
  const hunks = md.parseContentToListHunks(srcFile, content);
  const tasks = new Tasks();
  for (const hunk of hunks) {
    const mdTree = md.parseListHunkToTree(srcFile, hunk.lines);
    const hunkTasks = parseMDRootToTaskRoot(mdTree);
    // Ignore malformed contents if there are no valid tasks in the hunk.
    // Malformed contents I want are ones in the hunk with some tasks
    // because the malformed contents may be "tasks" in that case.
    if (hunkTasks.hasValidData()) {
      tasks.addAll(hunkTasks);
    }
  }
  return tasks.hasValidData() ? tasks : undefined;
}

export class Tasks {
  private weeklyData: WeeklyData[] = [];
  private dailyData: DailyData[] = [];
  private malformedMDs: MalformedMD[] = [];

  hasValidData() {
    return this.weeklyData.length > 0 || this.dailyData.length > 0;
  }

  hasMalformedMDs() {
    return this.malformedMDs.length > 0;
  }

  addMalformedMDs(...malformedMDs: MalformedMD[]) {
    this.malformedMDs.push(...malformedMDs);
  }

  getMalformedMDs() {
    return [...this.malformedMDs];
  }

  getWeeklyTasksByRange(range: DateRange) {
    for (const e of this.weeklyData) {
      if (e.range.equals(range)) return [...e.tasks];
    }
    return undefined;
  }

  getWeeklyTasksByFromDate(date: YMD): [DateRange, MDListNode[]] | undefined {
    for (const e of this.weeklyData) {
      if (e.range.from.equals(date)) return [e.range, [...e.tasks]];
    }
    return undefined;
  }

  getDailyTasksByDate(date: YMD) {
    for (const e of this.dailyData) {
      if (e.date.equals(date)) return [...e.tasks];
    }
    return undefined;
  }

  addWeekTasks(range: DateRange, ...tasks: MDListNode[]) {
    let tgtData = new WeeklyData(range);
    let found = false;
    for (const element of this.weeklyData) {
      if (element.range.equals(range)) {
        tgtData = element;
        found = true;
      }
    }
    tgtData.tasks.push(...tasks);
    if (!found) {
      this.weeklyData.push(tgtData);
    }
  }

  addDailyTasks(date: YMD, ...tasks: MDListNode[]) {
    let tgtData = new DailyData(date);
    let found = false;
    for (const element of this.dailyData) {
      if (element.date.equals(date)) {
        tgtData = element;
        found = true;
      }
    }
    tgtData.tasks.push(...tasks);
    if (!found) {
      this.dailyData.push(tgtData);
    }
  }

  addAll(tasks: Tasks) {
    this.addMalformedMDs(...tasks.malformedMDs);
    for (const weeklyDatum of tasks.weeklyData) {
      this.addWeekTasks(weeklyDatum.range, ...weeklyDatum.tasks);
    }
    for (const dailyDatum of tasks.dailyData) {
      this.addDailyTasks(dailyDatum.date, ...dailyDatum.tasks);
    }
  }

  getEarliestLatestDate(): { earliestYMD: YMD, latestYMD: YMD } | undefined {
    const dates: YMD[] = [];
    this.dailyData.map(value => value.date)
      .forEach(value => dates.push(value));
    this.weeklyData.map(value => value.range)
      .forEach(value => dates.push(value.from, value.to));
    if (dates.length < 1) {
      return undefined;
    }
    let earliest: YMD | undefined = undefined;
    let latest: YMD | undefined = undefined;
    for (const date of dates) {
      if (earliest === undefined || date.earlierThan(earliest)) {
        earliest = date;
      }
      if (latest === undefined || date.laterThan(latest)) {
        latest = date;
      }
    }
    if (earliest === undefined || latest === undefined) {
      return undefined;
    }
    return { earliestYMD: earliest, latestYMD: latest };
  }
}

function validateRange(range: DateRange) {
  if (range.from.toDate().getDay() !== WEEK_BEGIN_DAY || range.to.toDate().getDay() !== WEEK_END_DAY) {
    throw new Error("Invalid week range: " + range);
  }
}

class WeeklyData {
  range: DateRange;
  tasks: MDListNode[] = [];

  constructor(range: DateRange) {
    this.range = range;
  }
}

class DailyData {
  date: YMD;
  tasks: MDListNode[] = [];

  constructor(date: YMD) {
    this.date = date;
  }
}

function parseWeekStr(s: string): DateRange | string {
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

export function parseMDRootToTaskRoot(mdRoot: MDListRootNode): Tasks {
  const tasks = new Tasks();
  for (const rawDateOrRange of mdRoot.children) {
    const asMoment = moment(rawDateOrRange.text, DATE_FORMAT, true);
    if (asMoment.isValid()) { // Parse as TaskDay
      tasks.addDailyTasks(YMD.fromMoment(asMoment), ...rawDateOrRange.children)
    } else { // Parse as TaskWeek
      const weekRange = parseWeekStr(rawDateOrRange.text);
      if (typeof weekRange === "string") {
        // throw parseError(srcPath, "Invalid week: " + weekMD.text + " (" + weekRange + ")").toString();
        tasks.addMalformedMDs(new MalformedMD("Invalid range format", rawDateOrRange));
        continue;
      }
      try {
        validateRange(weekRange);
      } catch (e) {
        // skipped =  parseError(srcPath, "Invalid week: " + weekMD.text).toString();
        tasks.addMalformedMDs(new MalformedMD("Invalid week range", rawDateOrRange));
        continue;
      }
      tasks.addWeekTasks(weekRange, ...rawDateOrRange.children)
    }
  }
  return tasks;
}

function nextDay(date: Date, day: number): Date {
  const copyDate = new Date(date);
  while (copyDate.getDay() !== day) {
    copyDate.setDate(copyDate.getDate() + 1);
  }
  return copyDate;
}

export function generateTaskListTemplate(from: YMD, to: YMD) {
  let output: string = "";
  for (const currentYMD of genDates(from, to)) {
    const currentDate = currentYMD.toDate();
    if (currentDate.getDay() === WEEK_BEGIN_DAY) {
      const end = nextDay(currentDate, WEEK_END_DAY);
      output = output.concat("- " + moment(currentDate).format(DATE_FORMAT) +
        DATE_RANGE_DELIMITER + moment(end).format(DATE_FORMAT) + "\n");
    }
    output = output.concat("- " + moment(currentDate).format(DATE_FORMAT) + "\n");
  }
  return output;
}
