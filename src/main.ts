import {App, Modal, Notice, Plugin, Setting, TFile, TFolder} from 'obsidian';
import moment from 'moment';

import * as lib from "./lib.js"
import {MDListNode, Tasks} from "./lib.js"
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

/**
 * Returns the number of skipped tasks.
 *
 * @param html
 * @param tasks
 * @param header
 */
function createTaskListHTML(html: HTMLElement, tasks: MDListNode[], header?: boolean): number {
  if (!header) {
    for (const taskNode of tasks) {
      const taskLI = html.createEl("li");
      taskLI.textContent = taskNode.rawText;
      if (taskNode.children.length !== 0) {
        createTaskListHTML(taskLI.createEl("ul"), taskNode.children);
      }
    }
    return 0;
  } else {
    let skippedTasks = 0;
    // Make a group of nodes per source path
    const nodePerPath = new Map<string, MDListNode[]>();
    for (const task of tasks) {
      if (task.isAllChecked()){
        skippedTasks++;
        continue;
      }
      const got = nodePerPath.get(task.srcPath)
      if (got) {
        got.push(task);
      } else {
        nodePerPath.set(task.srcPath, [task]);
      }
    }
    for (const path of nodePerPath.keys()) {
      const pathLI = html.createEl("li");
      pathLI.textContent = path;
      createTaskListHTML(pathLI.createEl("ul"), nodePerPath.get(path)!);
    }
    return skippedTasks;
  }
}

/**
 * boolがtrueならe.textContentを<b>にしてかつemphasisTextをくっつける
 * @param bool
 * @param e
 * @param text
 * @param emphasisText
 */
function emphasisIfTrue(bool: boolean, e: HTMLElement, text: string, emphasisText: string) {
  if (bool) {
    e.createEl("b").textContent = text + emphasisText;
  } else {
    e.textContent = text;
  }
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
      const tgtUL = currentYMD.earlierThan(YMD.fromDate(oldTaskDateBound))
        ? oldTasksUL
        : futureTasksUL;
      // currentYMDの週のタスク一覧があれば生成する
      const weeklyTasks = tasks.getWeeklyTasksByFromDate(currentYMD);
      if (weeklyTasks !== undefined) {
        const weekLI = tgtUL.createEl("li");
        emphasisIfTrue(weeklyTasks[0].doesInclude(YMD.today()), weekLI, weeklyTasks[0].toString(), " (THIS WEEK)");
        const weeklyTaskUL = weekLI.createEl("ul");
        const skipped = createTaskListHTML(weeklyTaskUL, weeklyTasks[1], true);
        if (skipped !== 0) weeklyTaskUL.createEl("li").textContent = `${skipped} checked tasks`
      }
      // currentYMDの日のタスク一覧があれば生成する。なかった場合は日付だけ挿入。
      const dateLI = tgtUL.createEl("li");
      emphasisIfTrue(currentYMD.equals(YMD.today()), dateLI, currentYMD.toString(), " (TODAY)");
      const dailyTasks = tasks.getDailyTasksByDate(currentYMD);
      if (dailyTasks !== undefined) {
        const dayUL = dateLI.createEl("ul");
        const skipped = createTaskListHTML(dayUL, dailyTasks, true);
        if (skipped !== 0) dayUL.createEl("li").textContent = `${skipped} checked tasks`
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
          const srcPath = child.path
            .replace(rootPath + "/", "")
            .replace(/\.md$/, "");
          const fileTasks = lib.parseContentToTasks(srcPath, content);
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
