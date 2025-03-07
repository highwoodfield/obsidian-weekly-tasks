import {
	Plugin, TFile, TFolder
} from 'obsidian';

interface WTCSettings {
	mySetting: string;
}

const DEFAULT_SETTINGS: WTCSettings = {
	mySetting: 'default'
}

class TaskDate {
	year: number;
	month: number;
	day: number;

	constructor(year: number, month: number, day: number) {
		this.year = year;
		this.month = month;
		this.day = day;
	}

	toString() {
		return `${this.year}/${this.month}/${this.day}`;
	}

	compare(another: TaskDate): number {
		const y = this.year - another.year;
		if (y !== 0) return y;
		const m = this.month - another.month;
		if (m !== 0) return m;
		return this.day - another.day;
	}
}

interface Task {
	src: string,
	date: TaskDate | null;
	desc: string;
}

function getEpochTimeMillis(): number {
	return new Date().getTime();
}

function parseListElementsToTasks(src: string, elements: string[]) {
	// Whether date line exists or not. If there aren't date line,
	// then this hunk is not one with tasks.
	let dateLineExists = false;
	const tasks: Task[] = [];
	let currentDate: TaskDate | null = null;
	for (const element of elements) {
		// Match month (e.g., "- 2025/3/1")
		const dateMatch = element.match(/^(\d+)\/(\d+)\/(\d+)$/);
		if (dateMatch) {
			currentDate = new TaskDate(
				parseInt(dateMatch[1]),
				parseInt(dateMatch[2]),
				parseInt(dateMatch[3])
			);
			dateLineExists = true;
		} else {
			tasks.push({
				src: src,
				date: currentDate,
				desc: element
			})
		}
	}
	return dateLineExists ? tasks : [];
}

function parseMarkdownToTasks(src: string, markdown: string): Task[] {
    const lines = markdown.split("\n");
    const tasks: Task[] = [];
	//  Elements in a hunk
	const listElements: string[] = [];

    for (const line of lines) {
        const trimmed = line.trim();

		// Match list (e.g., "- aaa")
		const listMatch = trimmed.match(/^-\s+(.+)$/);
		if (listMatch) {
			listElements.push(listMatch[1]);
		}
		// If we exited from a hunk of list
		if (!listMatch && listElements.length > 0) {
			tasks.push(...parseListElementsToTasks(src, listElements));
			listElements.splice(0);
		}
    }
	if (listElements.length > 0) {
		tasks.push(...parseListElementsToTasks(src, listElements));
	}

    return tasks;
}

function createTaskListHTML(html: HTMLElement, title: string, tasks: Task[]) {
	const rootLI = html.createEl("li");
	rootLI.textContent = title;
	const tasksUL = rootLI.createEl("ul");
	for (const task of tasks) {
		const taskLI = tasksUL.createEl("li");
		taskLI.textContent = `${task.desc} (${task.src})`;
	}
}

// noinspection JSUnusedGlobalSymbols
export default class WTCPlugin extends Plugin {
	settings: WTCSettings;

	// Key: root path, Value: epoch time seconds
	latestUpdateTimes: Map<string, number> = new Map();
	// Key: root path, Value: tasks
	tasksMap: Map<string, Task[]> = new Map();

	async showTasks(src: string, el: HTMLElement) {
		await this.collectTasksIfNeeded(src.trim());
		const tasks = this.tasksMap.get(src.trim());
		if (!tasks) throw "Cache may be broken.";
		if (tasks.length === 0) {
			el.textContent = "WTC: No tasks found.";
			return;
		}

		const datedTasksMap: Map<string, Task[]> = new Map();
		const unknownDateTasks: Task[] = [];

		tasks.sort((a, b) => (a.date && b.date) ? a.date.compare(b.date) : 0);

		for (const task of tasks) {
			if (!task.date) {
				unknownDateTasks.push(task);
			} else {
				let currentTasks = datedTasksMap.get(task.date.toString());
				if (!currentTasks) {
					currentTasks = [];
					datedTasksMap.set(task.date.toString(), currentTasks);
				}
				currentTasks.push(task);
			}
		}
		const rootUL = el.createEl("ul");
		for (const date of datedTasksMap.keys()) {
			const datedTasks = datedTasksMap.get(date);
			if (!datedTasks) { throw "Unreachable" }
			createTaskListHTML(rootUL, date.toString(), datedTasks);
		}
		if (unknownDateTasks.length > 0) {
			createTaskListHTML(rootUL, "Unknown", unknownDateTasks);
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
		const tasks: Task[] = [];
		while (folderStack.length > 0) {
			const got = folderStack.pop();
			if (!got) throw "Unreachable";
			for (const child of got.children) {
				if (child instanceof TFolder) {
					folderStack.push(child);
				} else if (child instanceof TFile) {
					const content = await this.app.vault.cachedRead(child);
					tasks.push(...parseMarkdownToTasks(child.name, content));
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
				await this.showTasks(src, el);
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
