import {App, Modal, Notice, Plugin, Setting, TFile, TFolder} from 'obsidian';
import moment from 'moment';

import * as lib from "./lib.js"
import {MDListNode, MDNodeVisitor, SourceFile, Tasks} from "./lib.js"
import {DATE_FORMAT, YMD } from "./datetime";
import * as datetime from "./datetime.js"

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
    ctx.textContent = node.rawText;
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
 * Returns the number of skipped tasks.
 *
 * @param html
 * @param tasks
 * @param pathHeader
 */
function createTaskListHTML(html: HTMLElement, tasks: MDListNode[], pathHeader: boolean = false): number {
  let skippedTasks = 0;
  // Make a group of nodes per source path
  const nodePerPath = new Map<string, MDListNode[]>();
  for (const task of tasks) {
    if (task.isAllChecked()){
      skippedTasks++;
      continue;
    }
    const got = nodePerPath.get(task.srcFile.displayName)
    if (got) {
      got.push(task);
    } else {
      nodePerPath.set(task.srcFile.displayName, [task]);
    }
  }
  nodePerPath.forEach((samePathTasks, path) => {
    const pathLI = html.createEl("li");
    const link = pathLI.createEl("a");
    link.href = samePathTasks[0].srcFile.openURI;
    link.textContent = samePathTasks[0].srcFile.displayName;
    link.className = "obsidian-weekly-tasks-plain-anchor";
    const ul = pathLI.createEl("ul");
    samePathTasks.forEach(task => {
      task.visit(new TaskHTMLGenerator(), ul.createEl("li"));
    })
  })
  return skippedTasks;
}

/**
 * boolがtrueならe.textContentを<b>にしてかつemphasisTextをくっつける
 * @param bool
 * @param e
 * @param text
 * @param emphasisText
 */
function createTextSpan(bool: boolean, text: string, emphasisText: string): HTMLSpanElement {
  const el = document.createElement("span");
  if (bool) {
    el.createEl("b").textContent = text + " " + emphasisText;
  } else {
    el.textContent = text;
  }
  return el;
}

function createTasksUList(tasks: MDListNode[]): HTMLUListElement {
  const el = document.createElement("ul");
  const skipped = createTaskListHTML(el, tasks, true);
  if (skipped !== 0) el.createEl("li").textContent = `${skipped} checked tasks`
  return el;
}

function tFileToSrcFile(rootPath: string, f: TFile): SourceFile {
  const displayName = f.path
    .replace(rootPath + "/", "")
    .replace(/\.md$/, "");
  const uri = "obsidian://open?file=" +
    encodeURIComponent(f.path);
  return new SourceFile(uri, displayName);
}

// noinspection JSUnusedGlobalSymbols
export default class WTCPlugin extends Plugin {
  settings: WTCSettings;

  // Key: root path, Value: epoch time seconds
  latestUpdateTimes: Map<string, number> = new Map();
  // Key: root path, Value: tasks
  tasksMap: Map<string, lib.Tasks> = new Map();

  async showTasks(src: string, el: HTMLElement) {
    await this.collectTasksIfNeeded(src.trim());
    const tasks = this.tasksMap.get(src.trim());
    if (!tasks) throw "Cache may be broken.";
    const elDates = tasks.getEarliestLatestDate();
    if (elDates === undefined) {
      el.textContent = "WTC: No tasks found.";
      return;
    }
    const { earliestYMD, latestYMD } = elDates;

    const oldTaskDateBound = new Date();
    oldTaskDateBound.setDate(oldTaskDateBound.getDate() - 7);

    const details = el.createEl("details")
    details.createEl("summary").textContent = "Old Tasks";
    const oldTasksUL = details.createEl("ul");
    el.createEl("hr");
    const futureTasksUL = el.createEl("ul");
    for (const currentYMD of datetime.genDates(earliestYMD, latestYMD)) {
      const isOld = currentYMD.earlierThan(YMD.fromDate(oldTaskDateBound));
      const tgtUL = isOld ? oldTasksUL : futureTasksUL;
      // currentYMDの週のタスク一覧があれば生成する
      const weeklyTasks = tasks.getWeeklyTasksByFromDate(currentYMD);
      if (weeklyTasks !== undefined) {
        const weekLI = tgtUL.createEl("li");
        weekLI.append(createTextSpan(weeklyTasks[0].doesInclude(YMD.today()), weeklyTasks[0].toString(), "(THIS WEEK)"));
        weekLI.append(createTasksUList(weeklyTasks[1]));
      }
      // currentYMDの日のタスク一覧があれば生成する。なかった場合は日付だけ挿入。
      const dateLI = tgtUL.createEl("li");
      dateLI.append(createTextSpan(currentYMD.equals(YMD.today()), currentYMD.toString(), "(TODAY)"));
      const dailyTasks = tasks.getDailyTasksByDate(currentYMD);
      if (dailyTasks !== undefined) {
        dateLI.append(createTasksUList(dailyTasks));
      }
    }

    if (tasks.hasMalformedMDs()) {
      const malformedLI = futureTasksUL.createEl("li");
      malformedLI.textContent = "Malformed contents";
      const malformedUL = malformedLI.createEl("ul");
      tasks.getMalformedMDs().forEach(malformedMD => {
        const li = malformedUL.createEl("li");
        li.textContent = malformedMD.toString();
      });
    }
  }

  async collectTasksIfNeeded(rootPath: string) {
    const latestUpdateTime = this.latestUpdateTimes.get(rootPath);
    // Do nothing if we already have collected tasks and they are fresh enough.
    if (latestUpdateTime !== undefined
      && getEpochTimeMillis() < (latestUpdateTime + 1000)) {
      console.debug("Debounce", rootPath);
      return;
    }
    this.latestUpdateTimes.set(rootPath, getEpochTimeMillis());

    console.debug("Update", rootPath);

    const rootFolder = this.app.vault.getFolderByPath(rootPath);
    if (!rootFolder) {
      throw "No root folder found";
    }

    const folderStack: TFolder[] = [rootFolder];
    const tasks = new Tasks();
    while (folderStack.length > 0) {
      const got = folderStack.pop();
      if (!got) throw "Unreachable";
      for (const child of got.children) {
        if (child instanceof TFolder) {
          folderStack.push(child);
        } else if (child instanceof TFile) {
          const content = await this.app.vault.cachedRead(child);
          const fileTasks = lib.parseContentToTasks(tFileToSrcFile(rootPath, child), content);
          if (fileTasks) {
            for (const malformedMD of fileTasks.getMalformedMDs()) {
              console.log(malformedMD);
            }
            tasks.addAll(fileTasks);
          }
        } else {
          throw "Unreachable";
        }
      }
    }
    this.tasksMap.set(rootPath, tasks);
  }


  async onload() {
    await this.loadSettings();

    this.registerMarkdownCodeBlockProcessor("weekly-task-collect", async (src, el) => {
      try {
        const before = getEpochTimeMillis();
        await this.showTasks(src, el);
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
    const fromMmt = moment(this.from, DATE_FORMAT);
    const toMmt = moment(this.to, DATE_FORMAT);
    if (!fromMmt.isValid() || !toMmt.isValid()) {
      new Notice("Invalid format");
      return;
    }
    const text = lib.generateTaskListTemplate(fromMmt.toDate(), toMmt.toDate());
    const activeFile = this.app.workspace.getActiveFile();
    if (activeFile === null) return;
    await this.app.vault.append(activeFile, text);
  }

  onClose() {
    const {contentEl} = this;
    contentEl.empty();
  }
}
