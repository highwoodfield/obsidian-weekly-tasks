import moment from "moment";
import {DateRange, genDates, Temporal, Week, YMD} from "./datetime.js";
import * as md from "./md.js";
import {MDListNode, MDListRootNode, SourceFile} from "./md.js";

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

export function parseMDRootToTaskRoot(mdRoot: MDListRootNode): Tasks {
  const tasks = new Tasks();
  for (const rawDateOrRange of mdRoot.children) {
    const asYMD = YMD.fromString(rawDateOrRange.text)
    let temporal: Temporal;
    if (asYMD) { // Parse as TaskDay
      tasks.addDailyTasks(asYMD, ...rawDateOrRange.children)
      temporal = asYMD;
    } else { // Parse as TaskWeek
      const weekRange = DateRange.fromString(rawDateOrRange.text);
      if (typeof weekRange === "string") {
        // throw parseError(srcPath, "Invalid week: " + weekMD.text + " (" + weekRange + ")").toString();
        tasks.addMalformedMDs(new MalformedMD("Invalid range format", rawDateOrRange));
        continue;
      }
      if (!Week.isWeekRange(weekRange)) {
        tasks.addMalformedMDs(new MalformedMD("Invalid week range", rawDateOrRange));
        continue;
      }
      tasks.addWeekTasks(weekRange, ...rawDateOrRange.children)
      temporal = weekRange;
    }
  }
  return tasks;
}

export function generateTaskListTemplate(from: YMD, to: YMD) {
  let output: string = "";
  for (const currentYMD of genDates(from, to)) {
    if (Week.isBeginOfWeek(currentYMD)) {
      const week = Week.fromYMD(currentYMD);
      output = output.concat("- " + week.range.toString() + "\n");
    }
    output = output.concat("- " + currentYMD.toString() + "\n");
  }
  return output;
}

export interface Task {
  temporal: Temporal;
  task: MDListNode;
}

export abstract class Node {
  parent: Node | undefined;
  children: Node[] = [];

  constructor(parent: Node | undefined) {
    this.parent = parent;
  }

  abstract addTask(task: Task): void;
}

export class RootNode extends Node {
  children: TemporalNode[] = [];

  addTask(task: Task): void {
    let found = this.children.find(value => {
      return value.temporal.equals(task.temporal);
    })
    if (!found) {
      found = new TemporalNode(this, task.temporal);
      this.children.push(found);
    }
    found.addTask(task);
  }
}

export class TemporalNode extends Node {
  temporal: Temporal;
  children: SourceNode[] = [];

  constructor(parent: Node | undefined, temporal: Temporal) {
    super(parent);
    this.temporal = temporal;
  }

  addTask(task: Task): void {
    if (!this.temporal.equals(task.temporal)) {
      throw new Error("Illegal temporal: " + task.temporal);
    }
    let found = this.children.find(value => {
      return value.source.equals(task.task.srcFile);
    })
    if (!found) {
      found = new SourceNode(this, task.task.srcFile);
      this.children.push(found);
    }
    found.addTask(task);
  }

  compare(another: TemporalNode): number {
    return another.temporal.compareTemporal(another.temporal)
  }
}

export class SourceNode extends Node {
  source: SourceFile;
  children: TaskNode[] = [];

  constructor(parent: Node | undefined, source: SourceFile) {
    super(parent);
    this.source = source;
  }

  addTask(task: Task): void {
    if (!task.task.srcFile.equals(this.source)) {
      throw new Error("Illegal source file: " + task.task.srcFile);
    }
    this.children.push(new TaskNode(this, task));
  }
}

export class TaskNode extends Node {
  task: Task;

  constructor(parent: Node | undefined, task: Task) {
    super(parent);
    this.task = task;
  }

  addTask(task: Task): void {
    throw new Error("no-op");
  }
}
