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
		return moment(this.from).format(DATE_FORMAT) + DATE_RANGE_DELIMITER + moment(this.to).format(DATE_FORMAT);
	}
}

const WEEK_BEGIN_DAY = 1; // 1 for monday
const WEEK_END_DAY = 0; // 0 for monday

export class MDListNode {
	parent: MDListNode | undefined;
	srcPath: string;
	text: string;
	children: MDListNode[] = [];

	constructor(parent: MDListNode | undefined, srcPath: string, text: string) {
		this.parent = parent;
		this.srcPath = srcPath;
		this.text = text;
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
const REGEX_MD_LIST_SPACE = /^(\s*)-\s+(.+)/;
const REGEX_MD_LIST_TAB = /^(\t*)-\s+(.+)/;

class MDListLine {
	srcPath: string;
	text: string;
	regexArr: RegExpMatchArray;

	private constructor(srcPath: string, text: string, regexArr: RegExpMatchArray) {
		this.srcPath = srcPath;
		this.text = text;
		this.regexArr = regexArr;
	}

	static create(tab: boolean, srcPath: string, text: string): MDListLine | undefined {
		const match = text.match(tab ? REGEX_MD_LIST_TAB : REGEX_MD_LIST_SPACE);
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

export function parseContentToTasks(srcPath: string, content: string) {
	const hunks = parseContentToListHunks(srcPath, content);
	const taskRoot = new TaskRoot();
	for (const hunk of hunks) {
		const md = parseListHunkToTree(srcPath, hunk.lines);
		const childRoot = parseMDRootToTaskRoot(srcPath, md);
		if (typeof childRoot !== "number") {
			mergeTaskRoots(childRoot, taskRoot);
		} else if (childRoot > 0) {
			console.error(srcPath + ": Malformed entries: ", childRoot);
		}
	}
	return taskRoot;
}

export function parseContentToListHunks(srcPath: string, content: string): Hunk[] {
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
	const isTab = isTabIndent(rawLines);
	const lines = rawLines
		.map((line) => {
			const mdLine =  MDListLine.create(isTab, srcPath, line);
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
	malformedMDs: MDListNode[] = [];

	getTaskWeek(range: DateRange) {
		for (const e of this.taskWeeks) {
			if (e.range.equals(range)) return e;
		}
		return undefined;
	}
}

export class TaskWeek {
	range: DateRange;
	taskDays: TaskDay[] = [];
	tasks: MDListNode[] = [];

	constructor(range: DateRange) {
		if (range.from.toDate().getDay() !== WEEK_BEGIN_DAY || range.to.toDate().getDay() !== WEEK_END_DAY) {
			throw new Error("Invalid week range: " + range);
		}
		this.range = range;
	}

	getTaskDay(tgt: YMD) {
		for (const e of this.taskDays) {
			if (e.date.equals(tgt)) return e;
		}
		return undefined;
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
		const m = moment(rawDate, DATE_FORMAT, true);
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

export function parseMDRootToTaskRoot(srcPath: string, mdRoot: MDListRootNode): TaskRoot | number {
	const root = new TaskRoot();
	for (const weekMD of mdRoot.children) {
		const weekRange = parseWeekStr(weekMD.text);
		if (typeof weekRange === "string") {
			// throw parseError(srcPath, "Invalid week: " + weekMD.text + " (" + weekRange + ")").toString();
			root.malformedMDs.push(weekMD);
			continue;
		}
		let taskWeek: TaskWeek;
		try {
			taskWeek = new TaskWeek(weekRange);
		} catch (e) {
			// skipped =  parseError(srcPath, "Invalid week: " + weekMD.text).toString();
			root.malformedMDs.push(weekMD);
			continue;
		}
		root.taskWeeks.push(taskWeek);
		for (const weekElement of weekMD.children) {
			const m = moment(weekElement.text, DATE_FORMAT, true);
			if (m.isValid()) {
				const taskDay = new TaskDay(YMD.fromMoment(m));
				if (!taskWeek.range.doesInclude(taskDay.date)) {
					//throw parseError(srcPath, "date out of range");
					root.malformedMDs.push(weekElement);
					continue;
				}
				taskWeek.taskDays.push(taskDay);
				taskDay.tasks.push(...weekElement.children);
			} else {
				taskWeek.tasks.push(weekElement);
			}
		}
	}
	return root.taskWeeks.length !== 0 ? root : root.malformedMDs.length;
}

export function mergeTaskRoots(from: TaskRoot, to: TaskRoot) {
	to.malformedMDs.push(...from.malformedMDs)
	for (const fromTaskWeek of from.taskWeeks) {
		const toTaskWeek = to.getTaskWeek(fromTaskWeek.range);
		if (toTaskWeek === undefined) {
			to.taskWeeks.push(fromTaskWeek);
		} else {
			toTaskWeek.tasks.push(...fromTaskWeek.tasks);
			for (const fromTaskDay of fromTaskWeek.taskDays) {
				const toTaskDay = toTaskWeek.getTaskDay(fromTaskDay.date);
				if (toTaskDay === undefined) {
					toTaskWeek.taskDays.push(fromTaskDay);
				} else {
					toTaskDay.tasks.push(...fromTaskDay.tasks);
				}
			}
		}
	}
}


class YMD {
	year: number;
	month: number;
	day: number;

	constructor(year: number, month: number, day: number) {
		this.year = year;
		this.month = month;
		this.day = day;
	}

	static fromMoment(m: moment.Moment) {
		return this.fromDate(m.toDate());
	}

	static fromDate(m: Date) {
		return new YMD(m.getFullYear(), m.getMonth(), m.getDate());
	}

	toDate() {
		return new Date(this.year, this.month - 1, this.day);
	}

	toString() {
		return moment(this.toDate()).format(DATE_FORMAT);
	}

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
}

function nextDay(date: Date, day: number): Date {
	const copyDate = new Date(date);
	while (copyDate.getDay() !== day) {
		copyDate.setDate(copyDate.getDate() + 1);
	}
	return copyDate;
}

export function generateTaskListTemplate(from: Date, to: Date) {
	let cursor = new Date(from);
	let output: string = "";
	while (cursor.getTime() < to.getTime()) {
		const begin = nextDay(cursor, WEEK_BEGIN_DAY);
		const end = nextDay(begin, WEEK_END_DAY);
		cursor = new Date(end);
		output = output.concat("- " + moment(begin).format(DATE_FORMAT) +
			DATE_RANGE_DELIMITER + moment(end).format(DATE_FORMAT) + "\n");
	}
	return output;
}
