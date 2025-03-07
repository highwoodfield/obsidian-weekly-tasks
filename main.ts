import {
	Plugin, TFile, TFolder
} from 'obsidian';

import * as lib from "./lib.js"
import {MDListNode, TaskRoot, toEpochDate} from "./lib.js";

interface WTCSettings {
	mySetting: string;
}

const DEFAULT_SETTINGS: WTCSettings = {
	mySetting: 'default'
}

function getEpochTimeMillis(): number {
	return new Date().getTime();
}

function createTaskListHTML(html: HTMLElement, tasks: MDListNode) {
	const rootLI = html.createEl("li");
	rootLI.textContent = tasks.text;
	const tasksUL = rootLI.createEl("ul");
	for (const task of tasks.children) {
		createTaskListHTML(tasksUL, task);
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
		for (const taskWeek of tasks.taskWeeks) {
			const weekLI = rootUL.createEl("li");
			weekLI.textContent = taskWeek.range.toString();
			const weeklyTaskUL = weekLI.createEl("ul");
			taskWeek.tasks.forEach(value => createTaskListHTML(weeklyTaskUL, value));

			for (const taskDay of taskWeek.taskDays) {
				const dayLI = weeklyTaskUL.createEl("li");
				dayLI.textContent = taskDay.date.toString();
				const dayUL = dayLI.createEl("ul");
				taskDay.tasks.forEach(value => createTaskListHTML(dayUL, value));
			}
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

		const folderStack: TFolder[] = [ rootFolder];
		const taskRoot = new TaskRoot();
		while (folderStack.length > 0) {
			const got = folderStack.pop();
			if (!got) throw "Unreachable";
			for (const child of got.children) {
				if (child instanceof TFolder) {
					folderStack.push(child);
				} else if (child instanceof TFile) {
					const content = await this.app.vault.cachedRead(child);
					const md = lib.parseListHunkToTree(content.split("\n"));
					const taskRootChild = lib.parseMDRootToTaskRoot(md);
					lib.mergeTaskRoots(taskRootChild, taskRoot);
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
				el.textContent = "WTC: an error occurred";
			}
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
