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
	text: string;
	children: MDListNode[] = [];

	constructor(parent: MDListNode | undefined, text: string) {
		this.parent = parent;
		this.text = text;
	}
}

export class MDListRootNode extends MDListNode {
	constructor() {
		super(undefined, "ROOT");
	}
}

export function isTabIndent(lines: string[]) {
	return lines.find((line) => line.startsWith('\t')) !== undefined;
}


const DATE_RANGE_DELIMITER = " ~ ";
const DATE_FORMAT = "YYYY/MM/DD"
const REGEX_MD_LIST_SPACE = /^(\s*)-\s+(.+)/;
const REGEX_MD_LIST_TAB = /^(\t*)-\s+(.+)/;

class MDListLine {
	text: string;
	regexArr: RegExpMatchArray;

	private constructor(text: string, regexArr: RegExpMatchArray) {
		this.text = text;
		this.regexArr = regexArr;
	}

	static create(tab: boolean, text: string): MDListLine | undefined {
		const match = text.match(tab ? REGEX_MD_LIST_TAB : REGEX_MD_LIST_SPACE);
		if (!match) {
			return undefined;
		} else {
			return new MDListLine(text, match);
		}
	}

	getIndentCharLen(): number {
		return this.regexArr[1].length;
	}

	getIndentLevel(step: number) {
		if (this.getIndentCharLen() % step !== 0) throw new Error("Invalid step");
		return this.getIndentCharLen() / step;
	}

	getContent(): string {
		return this.regexArr[2];
	}

	toNode() {
		return new MDListNode(undefined, this.getContent());
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

export function parseListHunkToTree(rawLines: string[]): MDListNode {
	const isTab = isTabIndent(rawLines);
	const lines = rawLines
		.map((line) => {
			const mdLine =  MDListLine.create(isTab, line);
			if (mdLine === undefined) {
				throw new Error("Not a Markdown list line: " + line);
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
		if (indentLevel - lastIndentLevel > 1) {
			throw new Error("Indent level increased: from " + lastIndentLevel + " to " + indentLevel);
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

function parseWeekStr(s: string) {
	const dates = s.split(DATE_RANGE_DELIMITER)
		.map(value => {
			const m = moment(value, DATE_FORMAT, true);
			if (!m.isValid()) {
				throw new Error('Invalid date: ' + value);
			}
			return YMD.fromMoment(m);
		});
	if (dates.length !== 2) {
		throw new Error('Invalid week str: ' + s);
	}
	return new DateRange(dates[0], dates[1]);
}

export function parseMDRootToTaskRoot(mdRoot: MDListRootNode) {
	const root = new TaskRoot();
	for (const weekMD of mdRoot.children) {
		const weekRange = parseWeekStr(weekMD.text);
		const taskWeek = new TaskWeek(weekRange);
		root.taskWeeks.push(taskWeek);
		for (const weekElement of weekMD.children) {
			const m = moment(weekElement.text, DATE_FORMAT, true);
			if (m.isValid()) {
				const taskDay = new TaskDay(YMD.fromMoment(m));
				if (!taskWeek.range.doesInclude(taskDay.date)) {
					throw new Error("date out of range");
				}
				taskWeek.taskDays.push(taskDay);
				taskDay.tasks.push(...weekElement.children);
			} else {
				taskWeek.tasks.push(weekElement);
			}
		}
	}
	return root;
}

export function mergeTaskRoots(from: TaskRoot, to: TaskRoot) {
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

console.log("hey")

try {

	const md = parseListHunkToTree(`- 2025/03/03 ~ 2025/03/09
  - hello
  - 2025/03/04
    - hey
      - foo
  - world
- 2025/03/10 ~ 2025/03/16
  - hi`.split("\n"));
	console.log(parseMDRootToTaskRoot(md));
} catch (e) {
	console.error("err", e);
}
