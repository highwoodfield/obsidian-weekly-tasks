import moment from "moment";
import {DATE_FORMAT, DATE_RANGE_DELIMITER, DateRange, genDates, YMD} from "./datetime";

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
    return `${this.node.srcPath}: Malformed because: ${this.reason}`;
  }
}

const REGEX_CHECKBOX = /^\[(.)] (.+)$/
const CHECKBOX_UNDONE = " "

export function parseCheckBox(text: string): [check: string, content: string] | undefined {
  const match = text.match(REGEX_CHECKBOX);
  if (!match) return undefined;
  return [match[1], match[2]];
}

export class MDListNode {
  parent: MDListNode | undefined;
  srcPath: string;
  text: string;
  rawText: string;
  checkText: string | undefined = undefined;
  children: MDListNode[] = [];

  constructor(parent: MDListNode | undefined, srcPath: string, text: string) {
    this.parent = parent;
    this.srcPath = srcPath;
    this.rawText = text;
    this.text = text;

    const checkboxInfo = parseCheckBox(text);
    if (checkboxInfo) {
      this.checkText = checkboxInfo[0];
      this.text = checkboxInfo[1];
      //console.log(text, this.checkText, this.text);
    }
  }

  /**
   * If any of child nodes has unchecked checkbox, returns false.
   * Otherwise, returns the state of the top node.
   * If the top node doesn't have checkbox, it is treated as unchecked.
   */
  isAllChecked(): boolean {
    const hasUncheckedRecurse = (node: MDListNode): boolean | undefined => {
      for (const child of node.children) {
        const childResult = hasUncheckedRecurse(child);
        if (childResult !== undefined && childResult) return true;
      }
      return node.checkText === undefined
        ? undefined
        : node.checkText === CHECKBOX_UNDONE;
    }
    const hasUnchecked = hasUncheckedRecurse(this);
    if (hasUnchecked !== undefined && hasUnchecked) {
      return false;
    } else {
      return this.checkText !== undefined && this.checkText !== CHECKBOX_UNDONE;
    }
  }
}

export class MDListRootNode extends MDListNode {
  constructor() {
    super(undefined, "ROOT", "ROOT");
  }
}

export function isTabIndent(lines: string[]) {
  return lines.find((line) => line.startsWith('\t')) !== undefined;
}

const REGEX_MD_LIST_WITH_CONTENT = /^(\s*)-\s+(.+)$/;
const REGEX_MD_LIST_EMPTY = /^(\s*)-$/;

class MDListLine {
  readonly srcPath: string;
  readonly rawText: string;
  readonly indentCharLen: number;
  readonly content: string;

  constructor(srcPath: string, rawText: string, indentCharLen: number, content: string) {
    this.srcPath = srcPath;
    this.rawText = rawText;
    this.indentCharLen = indentCharLen;
    this.content = content;
  }

  static fromLine(srcPath: string, text: string): MDListLine | undefined {
    const matchWithContent = text.match(REGEX_MD_LIST_WITH_CONTENT);
    if (matchWithContent) {
      return new MDListLine(srcPath, text, matchWithContent[1].length, matchWithContent[2]);
    }
    const matchEmpty = text.match(REGEX_MD_LIST_EMPTY);
    if (matchEmpty) {
      return new MDListLine(srcPath, text, matchEmpty[1].length, "");
    }
    return undefined;
  }

  static isMDListLine(line: string): boolean {
    return MDListLine.fromLine("", line) !== undefined;
  }

  getIndentLevel(step: number) {
    if (this.indentCharLen % step !== 0) return undefined;
    return this.indentCharLen / step;
  }

  toNode() {
    return new MDListNode(undefined, this.srcPath, this.content);
  }
}

export function getMinimumIndentStep(lines: MDListLine[]) {
  let min = -1;
  for (const line of lines) {
    if (line.indentCharLen === 0) continue;
    if (min === -1 || line.indentCharLen < min) min = line.indentCharLen;
  }
  return min === -1 ? 2 : min;
}

function parseError(path: string, msg: string) {
  return new Error(path + ": Unable to parse: " + msg);
}

class Hunk {
  lines: string[]

  constructor(lines: string[]) {
    this.lines = Array.from(lines);
  }
}

/**
 * Returns undefined when there is no tasks in the content.
 *
 * @param srcPath
 * @param content
 */
export function parseContentToTasks(srcPath: string, content: string): Tasks | undefined {
  const hunks = parseContentToListHunks(srcPath, content);
  const tasks = new Tasks();
  for (const hunk of hunks) {
    const md = parseListHunkToTree(srcPath, hunk.lines);
    const hunkTasks = parseMDRootToTaskRoot(srcPath, md);
    // Ignore malformed contents if there are no valid tasks in the hunk.
    // Malformed contents I want are ones in the hunk with some tasks
    // because the malformed contents may be "tasks" in that case.
    if (hunkTasks.hasValidData()) {
      tasks.addAll(hunkTasks);
    }
  }
  return tasks.hasValidData() ? tasks : undefined;
}

export function parseContentToListHunks(_srcPath: string, content: string): Hunk[] {
  const buffer: string[] = []
  const hunks: Hunk[] = [];
  for (const line of content.split("\n")) {
    const isListElement = MDListLine.isMDListLine(line);
    if (buffer.length !== 0 && !isListElement) {
      hunks.push(new Hunk(buffer));
      buffer.splice(0);
    }
    if (isListElement) {
      buffer.push(line);
    }
  }
  hunks.push(new Hunk(buffer));

  return hunks;
}

export function parseListHunkToTree(srcPath: string, rawLines: string[]): MDListNode {
  const lines = rawLines
    .map((line) => {
      const mdLine = MDListLine.fromLine(srcPath, line);
      if (mdLine === undefined) {
        throw parseError(srcPath, "Not a Markdown list line: " + line);
      }
      return mdLine;
    });
  const indentStep = getMinimumIndentStep(lines);

  const root = new MDListRootNode();
  let lastNode: MDListNode = root;
  let lastIndentLevel = -1;
  for (const line of lines) {
    const node = line.toNode();

    const indentLevel = line.getIndentLevel(indentStep);
    if (indentLevel === undefined) {
      throw parseError(srcPath, "Malformed indentation")
    }
    if (indentLevel - lastIndentLevel > 1) {
      throw parseError(srcPath, "Indent level increased: from " + lastIndentLevel + " to " + indentLevel);
    }

    if (indentLevel == lastIndentLevel) {
      node.parent = lastNode.parent
      lastNode.parent?.children.push(node);
    } else if (indentLevel > lastIndentLevel) {
      node.parent = lastNode;
      lastNode.children.push(node);
    } else if (indentLevel < lastIndentLevel) {
      let shouldBeParent = lastNode.parent;
      for (let i = 0; i < (lastIndentLevel - indentLevel); i++) {
        shouldBeParent = shouldBeParent?.parent;
      }
      node.parent = shouldBeParent;
      shouldBeParent?.children.push(node);
    }
    //console.log(node, lastIndentLevel, indentLevel);

    lastIndentLevel = indentLevel;
    lastNode = node;
  }
  return root;
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

export function parseMDRootToTaskRoot(_srcPath: string, mdRoot: MDListRootNode): Tasks {
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

export function generateTaskListTemplate(from: Date, to: Date) {
  let output: string = "";
  for (const currentYMD of genDates(YMD.fromDate(from), YMD.fromDate(to))) {
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
