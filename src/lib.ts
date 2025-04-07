import moment from "moment";

export function toEpochDate(date: YMD): number {
  return Math.floor(date.toDate().getTime() / (24 * 60 * 60 * 1000));
}

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


export const DATE_RANGE_DELIMITER = " ~ ";
export const DATE_FORMAT = "YYYY/MM/DD"
const REGEX_MD_LIST = /^(\s*)-\s+(.+)/;

class MDListLine {
  srcPath: string;
  text: string;
  regexArr: RegExpMatchArray;

  private constructor(srcPath: string, text: string, regexArr: RegExpMatchArray) {
    this.srcPath = srcPath;
    this.text = text;
    this.regexArr = regexArr;
  }

  static create(srcPath: string, text: string): MDListLine | undefined {
    const match = text.match(REGEX_MD_LIST);
    if (!match) {
      return undefined;
    } else {
      return new MDListLine(srcPath, text, match);
    }
  }

  getIndentCharLen(): number {
    return this.regexArr[1].length;
  }

  getIndentLevel(step: number) {
    if (this.getIndentCharLen() % step !== 0) return undefined;
    return this.getIndentCharLen() / step;
  }

  getContent(): string {
    return this.regexArr[2];
  }

  toNode() {
    return new MDListNode(undefined, this.srcPath, this.getContent());
  }
}

export function getMinimumIndentStep(lines: MDListLine[]) {
  let min = -1;
  for (const line of lines) {
    if (line.getIndentCharLen() === 0) continue;
    if (min === -1 || line.getIndentCharLen() < min) min = line.getIndentCharLen();
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
export function parseContentToTasks(srcPath: string, content: string): TaskRoot | undefined {
  const hunks = parseContentToListHunks(srcPath, content);
  const taskRoot = new TaskRoot();
  for (const hunk of hunks) {
    const md = parseListHunkToTree(srcPath, hunk.lines);
    const childRoot = parseMDRootToTaskRoot(srcPath, md);
    // Ignore malformed contents if there are no valid tasks in the hunk.
    // Malformed contents I want are ones in the hunk with some tasks
    // because the malformed contents may be "tasks" in that case.
    if (childRoot.taskWeeks.length > 0 || childRoot.taskDays.length > 0) {
      mergeTaskRoots(childRoot, taskRoot);
    }
  }
  return taskRoot.taskWeeks.length > 0 ? taskRoot : undefined;
}

export function parseContentToListHunks(_srcPath: string, content: string): Hunk[] {
  const buffer: string[] = []
  const hunks: Hunk[] = [];
  for (const line of content.split("\n")) {
    const isListElement = line.trimStart()[0] === '-';
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
      const mdLine = MDListLine.create(srcPath, line);
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

export class TaskRoot {
  taskWeeks: TaskWeek[] = [];
  taskDays: TaskDay[] = [];
  malformedMDs: MalformedMD[] = [];

  getTaskWeek(range: DateRange) {
    for (const e of this.taskWeeks) {
      if (e.range.equals(range)) return e;
    }
    return undefined;
  }

  getTaskWeekByDate(date: YMD) {
    for (const e of this.taskWeeks) {
      if (e.range.from.equals(date)) return e;
    }
    return undefined;
  }

  getTaskDay(tgt: YMD) {
    for (const e of this.taskDays) {
      if (e.date.equals(tgt)) return e;
    }
    return undefined;
  }

  getEarliestLatestDate(): { earliestYMD: YMD, latestYMD: YMD } | undefined {
    const dates: YMD[] = [];
    this.taskDays.map(value => value.date)
      .forEach(value => dates.push(value));
    this.taskWeeks.map(value => value.range)
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

export class TaskWeek {
  range: DateRange;
  tasks: MDListNode[] = [];

  constructor(range: DateRange) {
    if (range.from.toDate().getDay() !== WEEK_BEGIN_DAY || range.to.toDate().getDay() !== WEEK_END_DAY) {
      throw new Error("Invalid week range: " + range);
    }
    this.range = range;
  }
}

export class TaskDay {
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

export function parseMDRootToTaskRoot(_srcPath: string, mdRoot: MDListRootNode): TaskRoot {
  const root = new TaskRoot();
  for (const child of mdRoot.children) {
    const asMoment = moment(child.text, DATE_FORMAT, true);
    if (asMoment.isValid()) { // Parse as TaskDay
      const taskDay = new TaskDay(YMD.fromMoment(asMoment));
      root.taskDays.push(taskDay);
      taskDay.tasks.push(...child.children);
    } else { // Parse as TaskWeek
      const weekRange = parseWeekStr(child.text);
      if (typeof weekRange === "string") {
        // throw parseError(srcPath, "Invalid week: " + weekMD.text + " (" + weekRange + ")").toString();
        root.malformedMDs.push(new MalformedMD("Invalid range format", child));
        continue;
      }
      let taskWeek: TaskWeek;
      try {
        taskWeek = new TaskWeek(weekRange);
      } catch (e) {
        // skipped =  parseError(srcPath, "Invalid week: " + weekMD.text).toString();
        root.malformedMDs.push(new MalformedMD("Invalid week range", child));
        continue;
      }
      root.taskWeeks.push(taskWeek);
      taskWeek.tasks.push(...child.children);
    }
  }
  return root;
}

/**
 * Merge two TaskRoots
 *
 * @param from will be merged to 'to'. 'from' itself won't be changed.
 * @param to will be modified. After modified, The range of TaskWeeks in 'to' will be unique.
 */
export function mergeTaskRoots(from: TaskRoot, to: TaskRoot) {
  to.malformedMDs.push(...from.malformedMDs)
  for (const fromTaskWeek of from.taskWeeks) {
    const toTaskWeek = to.getTaskWeek(fromTaskWeek.range);
    if (toTaskWeek === undefined) {
      to.taskWeeks.push(fromTaskWeek);
    } else {
      toTaskWeek.tasks.push(...fromTaskWeek.tasks);
    }
  }
  for (const fromTaskDay of from.taskDays) {
    const toTaskDay = to.getTaskDay(fromTaskDay.date);
    if (toTaskDay === undefined) {
      to.taskDays.push(fromTaskDay);
    } else {
      toTaskDay.tasks.push(...fromTaskDay.tasks);
    }
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
