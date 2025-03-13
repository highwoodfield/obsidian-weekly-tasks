import {
  App,
  Modal, Notice,
  Plugin, Setting, TFile, TFolder
} from 'obsidian';
import moment from 'moment';

import * as lib from "./lib.js"
import {MDListNode, TaskRoot} from "./lib.js";

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

// noinspection JSUnusedGlobalSymbols
export default class WTCPlugin extends Plugin {
  settings: WTCSettings;

  // Key: root path, Value: epoch time seconds
  latestUpdateTimes: Map<string, number> = new Map();
  // Key: root path, Value: tasks
  tasksMap: Map<string, lib.TaskRoot> = new Map();

  async showTasks(src: string, el: HTMLElement) {
    await this.collectTasksIfNeeded(src.trim());
    const tasks = this.tasksMap.get(src.trim());
    if (!tasks) throw "Cache may be broken.";
    if (tasks.taskWeeks.length === 0) {
      el.textContent = "WTC: No tasks found.";
      return;
    }

    const rootUL = el.createEl("ul");
    for (const taskWeek of tasks.taskWeeks.sort((a, b) => a.range.from.compare(b.range.from))) {
      const weekLI = rootUL.createEl("li");
      weekLI.textContent = taskWeek.range.toString();
      const weeklyTaskUL = weekLI.createEl("ul");

      for (const taskDay of taskWeek.taskDays.sort((a, b) => a.date.compare(b.date))) {
        const dayLI = weeklyTaskUL.createEl("li");
        dayLI.textContent = taskDay.date.toString();
        const dayUL = dayLI.createEl("ul");
        const skipped = createTaskListHTML(dayUL, taskDay.tasks, true);
        if (skipped !== 0) dayUL.createEl("li").textContent = `${skipped} checked tasks`
      }

      const skipped = createTaskListHTML(weeklyTaskUL, taskWeek.tasks, true);
      if (skipped !== 0) weeklyTaskUL.createEl("li").textContent = `${skipped} checked tasks`
    }
    if (tasks.malformedMDs.length > 0) {
      const malformedLI = rootUL.createEl("li");
      malformedLI.textContent = "Malformed contents";
      const malformedUL = malformedLI.createEl("ul");
      tasks.malformedMDs.forEach(malformedMD => {
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
    const taskRoot = new TaskRoot();
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
          const taskRootChild = lib.parseContentToTasks(srcPath, content);
          if (taskRootChild) {
            for (let malformedMD of taskRootChild.malformedMDs) {
              console.log(malformedMD);
            }
            lib.mergeTaskRoots(taskRootChild, taskRoot);
          }
        } else {
          throw "Unreachable";
        }
      }
    }
    this.tasksMap.set(rootPath, taskRoot);
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
        component.setDefaultFormat(lib.DATE_FORMAT)
          .onChange(value => {
            this.from = value;
          })
      })
    new Setting(contentEl)
      .setName("To")
      .addMomentFormat(component => {
        component.setDefaultFormat(lib.DATE_FORMAT)
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
    const fromMmt = moment(this.from, lib.DATE_FORMAT);
    const toMmt = moment(this.to, lib.DATE_FORMAT);
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
