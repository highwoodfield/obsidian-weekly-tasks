import {App, Modal, Notice, Plugin, Setting, TFile, TFolder} from 'obsidian';

import * as lib from "./lib.js"
import {RootNode, Node, Task} from "./lib.js"
import {DATE_FORMAT, DateRange, Temporal, YMD} from "./datetime";
import * as datetime from "./datetime.js"
import {MDListNode, MDNodeVisitor, SourceFile} from "./md";

const CLASS_UNDONE = "obsidian-weekly-tasks-undone"

interface WTCSettings {
  mySetting: string;
}

const DEFAULT_SETTINGS: WTCSettings = {
  mySetting: 'default'
}

function getEpochTimeMillis(): number {
  return new Date().getTime();
}

class TaskHTMLGenerator implements MDNodeVisitor<HTMLElement> {
  enter(node: MDListNode, ctx: HTMLElement): () => HTMLElement {
    //ctx.textContent = node.rawText;
    ctx.append(node.toHTMLElement());
    return () => document.createElement("li");
  }

  exit(node: MDListNode, parentCtx: HTMLElement, childrenCtx: HTMLElement[]): void {
    let ul: HTMLElement | undefined = undefined;
    childrenCtx.forEach(childCtx => {
      if (childCtx.hasChildNodes()) {
        if (ul === undefined) {
          ul = parentCtx.createEl("ul");
        }
        ul.append(childCtx);
      }
    })
  }
}

/**
 * boolがtrueならe.textContentを<b>にしてかつemphasisTextをくっつける
 * @param bool
 * @param text
 * @param emphasisText
 */
function createTextSpan(bool: boolean, text: string, emphasisText: string): HTMLSpanElement {
  const el = document.createElement("span");
  el.style.paddingRight = "4px";
  if (bool) {
    el.createEl("b").textContent = text + " " + emphasisText;
  } else {
    el.textContent = text;
  }
  return el;
}

function tFileToSrcFile(rootPaths: string[], f: TFile): SourceFile {
  let displayName: string | undefined = undefined;
  for (const rootPath of rootPaths) {
    if (f.path.contains(rootPath)) {
      displayName = f.path
        .replace(rootPath + "/", "")
        .replace(/\.md$/, "");
      break;
    }
  }
  if (displayName === undefined) {
    throw new Error("filename mismatch: " + rootPaths + " and " + f.path);
  }
  const uri = "obsidian://open?file=" +
    encodeURIComponent(f.path);
  return new SourceFile(uri, displayName);
}

class TaskVisitCtx {
  static readonly EMPTY = new TaskVisitCtx();
  li = document.createElement("li");
  isDone: boolean | undefined = undefined;
}

class TemporalCtx extends TaskVisitCtx {
  temporal: Temporal | undefined = undefined;
  isOld: boolean | undefined = undefined;
}

class SourceCtx extends TaskVisitCtx {
  sourceFile: SourceFile | undefined = undefined;
  shortName: string | undefined = undefined;
  undoneCount: number | undefined = undefined;
}

class TaskNodeVisitor implements lib.NodeVisitor<TaskVisitCtx> {
  private readonly oldTaskDateBound: Date;
  private readonly oldTasksUL: HTMLElement;
  private readonly futureTasksUL: HTMLElement;

  constructor(oldTaskDateBound: Date, oldTasksUL: HTMLElement, futureTasksUL: HTMLElement) {
    this.oldTaskDateBound = oldTaskDateBound;
    this.oldTasksUL = oldTasksUL;
    this.futureTasksUL = futureTasksUL;
  }

  enter(node: Node, ctx: TaskVisitCtx): () => TaskVisitCtx {
    switch (node.type) {
      case "Root":
        return () => new TemporalCtx();
      case "Temporal":
        return () => new SourceCtx();
      case "Source":
        return () => new TaskVisitCtx();
      case "Task":
        return this.enterTask(node as lib.TaskNode, ctx);
    }
  }

  enterTask(node: lib.TaskNode, ctx: TaskVisitCtx): () => TaskVisitCtx {
    ctx.isDone = node.task.task.isAllChecked();
    if (!ctx.isDone) {
      node.task.task.visit(new TaskHTMLGenerator(), ctx.li!);
    }
    // empty context because TaskNode doesn't have children
    return () => TaskVisitCtx.EMPTY;
  }

  exit(node: Node, ctx: TaskVisitCtx, childrenCtx: TaskVisitCtx[]): void {
    switch (node.type) {
      case "Root":
        this.exitRoot(node, ctx, childrenCtx as TemporalCtx[]);
        break;
      case "Temporal":
        this.exitTemporal(node as lib.TemporalNode, ctx as TemporalCtx, childrenCtx as SourceCtx[]);
        break;
      case "Source":
        this.exitSource(node as lib.SourceNode, ctx as SourceCtx, childrenCtx);
        break;
    }
  }

  exitRoot(node: Node, ctx: TaskVisitCtx, childrenCtx: TemporalCtx[]): void {
    let prevTemporal: Temporal | undefined = undefined;
    for (const childCtx of childrenCtx) {
      const tgtUL = childCtx.isOld ? this.oldTasksUL : this.futureTasksUL;
      // 日付の補完
      if (prevTemporal) {
        let cursor = prevTemporal.getDate();
        while (true) {
          cursor = cursor.plusDays(1)
          if (!cursor.earlierThan(childCtx.temporal!.getDate())) {
            break;
          }
          tgtUL.createEl("li").append(createTextSpan(cursor.equals(YMD.today()), cursor.toString(), "(TODAY)"));
        }
      }

      tgtUL.append(childCtx.li!);
      prevTemporal = childCtx.temporal;
    }
  }

  exitTemporal(node: lib.TemporalNode, ctx: TemporalCtx, childrenCtx: SourceCtx[]): void {
    const temporal = node.temporal;
    ctx.temporal = temporal;
    ctx.isOld = temporal.getDate().earlierThan(YMD.fromDate(this.oldTaskDateBound));
    const details = ctx.li!.createEl("details");
    details.open = true;
    details.classList.add(CLASS_UNDONE);
    const summary = details.createEl("summary");
    if (temporal instanceof YMD) {
      summary.append(createTextSpan(temporal.equals(YMD.today()), temporal.toString(), "(TODAY)"));
    } else if (temporal instanceof DateRange) {
      summary.append(createTextSpan(temporal.doesInclude(YMD.today()), temporal.toString(), "(THIS WEEK)"));
    }
    const undoneUL = details.createEl("ul");
    for (const childCtx of childrenCtx) {
      // タスクの概要を日付の行にinlineで追加する
      const span = summary.createSpan();
      span.style.paddingLeft = "4px";
      span.append(childCtx.sourceFile!.toAnchor(`${childCtx.shortName}(${childCtx.undoneCount})`))
      if (childCtx.undoneCount === 0) {
        span.style.opacity = "0.5";
      }
      // 未完了タスクがあれば、undoneULに追加する
      if (childCtx.undoneCount! > 0) {
        undoneUL.append(childCtx.li!);
      }
    }
  }

  exitSource(node: lib.SourceNode, ctx: SourceCtx, childrenCtx: TaskVisitCtx[]): void {
    const pathLI = ctx.li!
    pathLI.append(node.source.toAnchor(node.source.displayName));

    const pathUL = pathLI.createEl("ul");
    pathUL.append(...childrenCtx.filter(v => !v.isDone).map(v => v.li!));

    const skipped = childrenCtx.filter(value => value.isDone).length;
    ctx.undoneCount = childrenCtx.length - skipped;

    const dispNameElements = node.source.displayName.split(/([-\/])/);
    ctx.shortName = dispNameElements[dispNameElements.length - 1].substring(0, 2);
    ctx.sourceFile = node.source;
  }

  exitTask(node: Node, ctx: TaskVisitCtx, childrenCtx: TaskVisitCtx[]): void {

  }
}

// noinspection JSUnusedGlobalSymbols
export default class WTCPlugin extends Plugin {
  settings: WTCSettings;

  // Key: root path, Value: epoch time seconds
  latestUpdateTimes: Map<string, number> = new Map();
  // Key: root path, Value: tasks
  tasksMap: Map<string, RootNode> = new Map();

  async showTasks(src: string[], el: HTMLElement) {
    await this.collectTasksIfNeeded(src);
    const tasks = this.tasksMap.get(src.join(";"));
    if (!tasks) throw "Cache may be broken.";

    const oldTaskDateBound = new Date();
    oldTaskDateBound.setDate(oldTaskDateBound.getDate() - 7);
    const checkbox = el.createEl("input", { type: "checkbox" });
    checkbox.addEventListener("click",() => {
      const elements = document.getElementsByClassName(CLASS_UNDONE);
      for (let i = 0; i < elements.length; i++) {
        const e = elements[i];
        if (e instanceof HTMLDetailsElement) {
          e.open = !checkbox.checked;
        }
      }
    })
    el.createSpan().textContent = "Summary"

    const details = el.createEl("details")
    details.createEl("summary").textContent = "Old Tasks";
    const oldTasksUL = details.createEl("ul");
    el.createEl("hr");
    const futureTasksUL = el.createEl("ul");

    if (tasks.malformedMDs.length !== 0) {
      const malformedLI = futureTasksUL.createEl("li");
      malformedLI.textContent = "Malformed contents";
      const malformedUL = malformedLI.createEl("ul");
      tasks.malformedMDs.forEach(malformedMD => {
        const li = malformedUL.createEl("li");
        li.textContent = malformedMD.toString();
      });
    }

    tasks.sortByDateIfNeeded();
    tasks.visit<TaskVisitCtx>(TaskVisitCtx.EMPTY, new TaskNodeVisitor(oldTaskDateBound, oldTasksUL, futureTasksUL));
  }

  async collectTasksIfNeeded(rootPaths: string[]) {
    const latestUpdateTime = this.latestUpdateTimes.get(rootPaths.join(";"));
    // Do nothing if we already have collected tasks and they are fresh enough.
    if (latestUpdateTime !== undefined
      && getEpochTimeMillis() < (latestUpdateTime + 1000)) {
      console.debug("Debounce", rootPaths);
      return;
    }
    this.latestUpdateTimes.set(rootPaths.join(";"), getEpochTimeMillis());

    console.debug("Update", rootPaths);

    const rootFolders = rootPaths
      .map(value => this.app.vault.getFolderByPath(value))
      .filter(value => value !== null)
      .map(value => value!);
    if (rootFolders.length !== rootPaths.length) {
      throw "some root folders cannot be found";
    }

    const folderStack = [...rootFolders];
    const tasks = new RootNode();
    while (folderStack.length > 0) {
      const got = folderStack.pop();
      if (!got) throw "Unreachable";
      for (const child of got.children) {
        if (child instanceof TFolder) {
          folderStack.push(child);
        } else if (child instanceof TFile) {
          const content = await this.app.vault.cachedRead(child);
          const fileTasks = lib.parseContentToTasks(tFileToSrcFile(rootPaths, child), content);
          if (fileTasks) {
            for (const malformedMD of fileTasks.malformedMDs) {
              console.log(malformedMD);
            }
            tasks.addAllTasks(fileTasks);
          }
        } else {
          throw "Unreachable";
        }
      }
    }
    this.tasksMap.set(rootPaths.join(";"), tasks);
  }

  async onload() {
    await this.loadSettings();

    this.registerMarkdownCodeBlockProcessor("weekly-task-collect", async (src, el) => {
      try {
        const before = getEpochTimeMillis();
        const paths = src.split("\n")
          .map(value => value.trim())
          .filter(value => value !== "");
        await this.showTasks(paths, el);
        const after = getEpochTimeMillis();
        console.debug("showTasks() took " + (after - before) + " ms");
      } catch (e) {
        console.error(e);
        el.textContent = "WTC: an error occurred: " + e;
      }
    });

    this.addRibbonIcon("list-todo", "Insert a template for weekly tasks", () => {
      new TemplateInsertionModal(this.app).open();
    });
    this.addRibbonIcon("calendar-range", "Insert a template for regular tasks", () => {
      new RegularTaskInsertionModal(this.app).open();
    })
  }

  onunload() {

  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings() {
    //await this.saveData(this.settings);
  }
}

class TemplateInsertionModal extends Modal {
  from: string | undefined = undefined;
  to: string | undefined = undefined;

  constructor(app: App) {
    super(app);
  }

  onOpen() {
    const {contentEl} = this;
    new Setting(contentEl)
      .setName("From")
      .addMomentFormat(component => {
        component.setDefaultFormat(DATE_FORMAT)
          .onChange(value => {
            this.from = value;
          })
      })
    new Setting(contentEl)
      .setName("To")
      .addMomentFormat(component => {
        component.setDefaultFormat(DATE_FORMAT)
          .onChange(value => {
            this.to = value;
          })
      })
    new Setting(contentEl)
      .addButton(component => {
        component.setButtonText("OK")
          .onClick(async () => {
            this.close();
            await this.insertText();
          });
      })
  }

  async insertText() {
    const from = YMD.fromString(this.from!);
    const to = YMD.fromString(this.to!);
    if (!from || !to) {
      new Notice("Invalid format");
      return;
    }
    const text = lib.generateTaskListTemplate(from, to);
    const activeFile = this.app.workspace.getActiveFile();
    if (activeFile === null) return;
    await this.app.vault.append(activeFile, text);
  }

  onClose() {
    const {contentEl} = this;
    contentEl.empty();
  }
}

function noticeIfUndefined(obj: any | undefined, msg: string) {
  if (obj) return;
  new Notice(msg);
}

class RegularTaskInsertionModal extends Modal {
  from: YMD | undefined = undefined;
  to: YMD | undefined = undefined;
  day: number | undefined = undefined;
  taskMD: string = "";

  constructor(app: App) {
    super(app);
  }

  onOpen() {
    const {contentEl} = this;
    new Setting(contentEl)
      .setName("From")
      .addMomentFormat(component => {
        component.setDefaultFormat(DATE_FORMAT)
          .onChange(value => {
            this.from = YMD.fromString(value);
            noticeIfUndefined(this.from, "invalid: " + value);
          })
      })
    new Setting(contentEl)
      .setName("To")
      .addMomentFormat(component => {
        component.setDefaultFormat(DATE_FORMAT)
          .onChange(value => {
            this.to = YMD.fromString(value);
            noticeIfUndefined(this.to, "invalid: " + value);
          })
      })
    new Setting(contentEl)
      .setName("曜日")
      .addDropdown(component => {
        ["日", "月", "火", "水", "木", "金", "土"].forEach((value, index) => {
          component.addOption(index.toString(), value);
        });
        component.onChange(value => {
          this.day = Number.parseInt(value);
        })
      })
    new Setting(contentEl)
      .setName("タスク(Markdown)")
      .addTextArea(component => {
        component.onChange(value => this.taskMD = value);
      })
    new Setting(contentEl)
      .addButton(component => {
        component.setButtonText("OK")
          .onClick(async () => {
            this.close();
            await this.insertText();
          });
      })
  }

  async insertText() {
    let text = "\n\n";
    for (const d of datetime.genDates(this.from!, this.to!)) {
      if (d.toDate().getDay() !== this.day!) continue;
      text += "- " + d.toString() + "\n";
      this.taskMD.split("\n").forEach(value => {
        text += "    " + value + "\n";
      })
    }
    const activeFile = this.app.workspace.getActiveFile();
    if (activeFile === null) return;
    await this.app.vault.append(activeFile, text);
  }

  onClose() {
    const {contentEl} = this;
    contentEl.empty();
  }
}
