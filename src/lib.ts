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
export function parseContentToTasks(srcFile: SourceFile, content: string): RootNode | undefined {
  const hunks = md.parseContentToListHunks(srcFile, content);
  const tasks = new RootNode();
  for (const hunk of hunks) {
    const mdTree = md.parseListHunkToTree(srcFile, hunk.lines);
    const hunkTasks = parseMDRootToTaskRoot(mdTree);
    // Ignore malformed contents if there are no valid tasks in the hunk.
    // Malformed contents I want are ones in the hunk with some tasks
    // because the malformed contents may be "tasks" in that case.
    if (hunkTasks.hasTasks()) {
      tasks.addAllTasks(hunkTasks);
    }
  }
  return tasks.hasTasks() ? tasks : undefined;
}

export function parseMDRootToTaskRoot(mdRoot: MDListRootNode): RootNode {
  const rootNode = new RootNode();
  for (const rawDateOrRange of mdRoot.children) {
    const asYMD = YMD.fromString(rawDateOrRange.text)
    let temporal: Temporal;
    if (asYMD) { // Parse as TaskDay
      temporal = asYMD;
    } else { // Parse as TaskWeek
      const weekRange = DateRange.fromString(rawDateOrRange.text);
      if (typeof weekRange === "string") {
        rootNode.malformedMDs.push(new MalformedMD("Invalid range format", rawDateOrRange));
        continue;
      }
      if (!Week.isWeekRange(weekRange)) {
        rootNode.malformedMDs.push(new MalformedMD("Invalid week range", rawDateOrRange));
        continue;
      }
      temporal = weekRange;
    }
    for (const child of rawDateOrRange.children) {
      rootNode.addTask({
        task: child,
        temporal: temporal,
      });
    }
  }
  return rootNode;
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

export interface NodeVisitor<Ctx> {
  /**
   *
   * @param node 入ったノード
   * @param ctx 親から渡されたコンテクスト
   * @return 子に渡すコンテクストを生成する関数
   */
  enter(node: Node, ctx: Ctx): () => Ctx;

  /**
   * @param node 出たノード
   * @param ctx 親から渡されたコンテクスト
   * @param childrenCtx 子に渡したすべてのコンテクスト
   */
  exit(node: Node, ctx: Ctx, childrenCtx: Ctx[]): void;
}

type NodeType = "Root" | "Temporal" | "Source" | "Task"

export abstract class Node {
  parent: Node | undefined;
  children: Node[] = [];
  readonly type: NodeType;

  protected constructor(type: NodeType, parent: Node | undefined) {
    this.parent = parent;
    this.type = type;
  }

  abstract addTask(task: Task): void;

  visit<Ctx>(initialCtx: Ctx, visitor: NodeVisitor<Ctx>): void {
    function visitRecursive(node: Node, ctx: Ctx) {
      const childCtxGenerator = visitor.enter(node, ctx);
      const childrenCtx: Ctx[] = [];
      for (const child of node.children) {
        const childCtx = childCtxGenerator();
        visitRecursive(child, childCtx);
        childrenCtx.push(childCtx);
      }
      visitor.exit(node, ctx, childrenCtx);
    }

    visitRecursive(this, initialCtx);
  }
}

export class RootNode extends Node {
  children: TemporalNode[] = [];
  malformedMDs: MalformedMD[] = [];
  private isSorted = false;

  constructor() {
    super("Root", undefined);
  }

  hasTasks(): boolean {
    return this.children.length > 0;
  }

  addTask(task: Task): void {
    this.isSorted = false;
    let found = this.children.find(value => {
      return value.temporal.equals(task.temporal);
    })
    if (!found) {
      found = new TemporalNode(this, task.temporal);
      this.children.push(found);
    }
    found.addTask(task);
  }

  addAllTasks(rootNode: RootNode) {
    rootNode.visit(this, new class implements NodeVisitor<RootNode> {
      enter(node: Node, ctx: RootNode): () => RootNode {
        if (node instanceof TaskNode) {
          ctx.addTask(node.task);
        }
        return function () {
          return ctx;
        };
      }

      exit(node: Node, ctx: RootNode, childrenCtx: RootNode[]): void {
      }
    });
  }

  sortByDateIfNeeded() {
    if (this.isSorted) return;
    this.isSorted = true;
    // sort with descending order
    // TODO: I don't know why a.compare(b) makes the order descending. (Shouldn't it be b.compare(a)?)
    this.children.sort((a, b) => a.compare(b));
  }
}

export class TemporalNode extends Node {
  temporal: Temporal;
  children: SourceNode[] = [];

  constructor(parent: Node | undefined, temporal: Temporal) {
    super("Temporal", parent);
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
    return this.temporal.compareTemporal(another.temporal)
  }
}

export class SourceNode extends Node {
  source: SourceFile;
  children: TaskNode[] = [];

  constructor(parent: Node | undefined, source: SourceFile) {
    super("Source", parent);
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
    super("Task", parent);
    this.task = task;
  }

  addTask(task: Task): void {
    throw new Error("no-op");
  }
}
