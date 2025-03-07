import moment from "moment";

export function toEpochDate(date: Date): number {
	return Math.floor(date.getTime() / (24 * 60 * 60 * 1000));
}

export class DateRange {
	from: Date;
	to: Date;

	constructor(from: Date, to: Date) {
		if (toEpochDate(from) > toEpochDate(to)) {
			throw new Error(`Invalid date range (from: ${from}, to: ${to})`);
		}
		this.from = from;
		this.to = to;
	}

	doesInclude(tgt: Date | DateRange): boolean {
		if (tgt instanceof Date) {
			return toEpochDate(this.from) <= toEpochDate(tgt) &&
				toEpochDate(tgt) <= toEpochDate(this.to);
		} else {
			return this.doesInclude(tgt.from) && this.doesInclude(tgt.to);
		}
	}

	equals(another: DateRange): boolean {
		return this.from.getTime() === another.from.getTime() && this.to.getTime() === another.to.getTime();
	}
}

const WEEK_BEGIN_DAY = 1; // 1 for monday
const WEEK_END_DAY = 0; // 0 for monday

class Node {
	parent: Node | undefined;
	children: Node[] = [];
	invalid: string | null = null;

	constructor(parent: Node | undefined) {
		this.parent = parent;
	}

	setParent(parent: Node) {
		this.parent = parent;
		parent.children.push(this);
	}
}

class RootNode extends Node {
	invalidNodes: Node[] = [];

	constructor() {
		super(undefined);
	}
}

class WeekNode extends Node {
	range: DateRange;

	constructor(parent: Node | undefined, range: DateRange) {
		super(parent);
		this.range = range;
	}

	isValidRange() {
		return this.range.from.getDay() === WEEK_BEGIN_DAY && this.range.to.getDay() === WEEK_END_DAY
	}
}

class DateNode extends Node {
	date: Date;

	constructor(parent: Node | undefined, date: Date) {
		super(parent);
		this.date = date;
	}
}

class TaskNode extends Node {
	task: string;

	constructor(parent: Node | undefined, task: string) {
		super(parent);
		this.task = task;
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
		if (this.getIndentCharLen() % step !== 0) throw "Invalid step";
		return this.getIndentCharLen() / step;
	}

	getContent(): string {
		return this.regexArr[2];
	}

	toNode() {
		if (this.getContent().indexOf(DATE_RANGE_DELIMITER) !== -1) {
			return this.toRangeNode();
		} else if (moment(this.getContent(), DATE_FORMAT, true).isValid()) {
			return this.toDateNode();
		} else {
			return this.toTaskNode();
		}
	}

	private toTaskNode() {
		return new TaskNode(undefined, this.getContent());
	}

	private toRangeNode() {
		const dates = this.getContent().split(DATE_RANGE_DELIMITER)
			.map(date => { return moment(date, DATE_FORMAT, true) });
		return new WeekNode(undefined, new DateRange(dates[0].toDate(), dates[1].toDate()));
	}

	private toDateNode() {
		const date = moment(this.getContent(), DATE_FORMAT, true);
		return new DateNode(undefined, date.toDate());
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

export function parseListHunkToTasks(rawLines: string[]): Node {
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

	const root = new RootNode();
	let lastNode: Node = root;
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
	validateTree(root, root);
	return root;
}

export function mergeRootNodes(from: RootNode, to: RootNode) {
	const fromWeeks = from.children as WeekNode[];
	for (const fromWeek of fromWeeks) {
		let toWeek: WeekNode | undefined = undefined;
		for (const toNode of to.children) {
			if (toNode instanceof WeekNode && toNode.range.equals(fromWeek.range)) {
				toWeek = toNode;
			}
		}
		if (!toWeek) {
			to.children.push(fromWeek);
		} else {
			for (const fromNode of fromWeek.children) {
				if (!(fromNode instanceof DateNode)) {
					toWeek.children.push(fromNode);
				} else {
					let toDate: DateNode | undefined = undefined;
					for (const toNode of toWeek.children) {
						if (toNode instanceof DateNode && toNode.date.getTime() === fromNode.date.getTime()) {
							toDate = toNode;
						}
					}
					if (!toDate) {

					}
				}
			}
		}
	}
}

function validateTree(root: RootNode, node: Node) {
	if (node instanceof WeekNode) {
		if (!(node.parent instanceof RootNode)) {
			node.invalid = "WeekNode should only be under RootNode";
		} else if (!node.isValidRange()) {
			node.invalid = "The range of WeekNode is invalid"
		} else {
			let sameCnt = 0;
			for (const child of node.parent.children) {
				if (child instanceof WeekNode && child.range.equals(node.range)) {
					sameCnt++;
				}
			}
			if (sameCnt > 1) {
				node.invalid = "Duplicate range";
			}
		}
	} else if (node instanceof DateNode) {
		if (!(node.parent instanceof WeekNode)) {
			node.invalid = "DateNode should only be under WeekNode";
		} else if (!node.parent.range.doesInclude(node.date)) {
			node.invalid = "DateNode should be included in the upper WeekNode"
		} else {
			let sameCnt = 0;
			for (const child of node.parent.children) {
				if (child instanceof DateNode && child.date.getTime() === node.date.getTime()) {
					sameCnt++;
				}
			}
			if (sameCnt > 1) {
				node.invalid = "Duplicate date";
			}
		}
	} else if (node instanceof TaskNode) {
		if (node.parent instanceof RootNode) {
			node.invalid = "TaskNode should not be under RootNode";
		}
	} else if (node instanceof RootNode) {
		// no-op
	} else {
		throw new Error("Unreachable");
	}
	if (node.invalid) {
		node.parent?.children.splice(node.parent?.children.indexOf(node), 1);
		node.parent = root;
		root.invalidNodes.push(node);
		return;
	}

	// if node is ok then check its children
	for (const child of node.children) {
		validateTree(root, child);
	}
}

console.log("hey")

try {

	console.log(parseListHunkToTasks(`- 2025/03/03 ~ 2025/03/09
  - hello
  - 2025/03/04
    - hey
  - world
- 2025/03/10 ~ 2025/03/16
  - hi
- invalidkamo`.split("\n")))
} catch (e) {
	console.error("err", e);
}
