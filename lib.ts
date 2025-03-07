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

class MDListNode {
	parent: MDListNode | undefined;
	text: string;
	children: MDListNode[] = [];

	constructor(parent: MDListNode | undefined, text: string) {
		this.parent = parent;
		this.text = text;
	}
}

class RootNode extends MDListNode {
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

	const root = new RootNode();
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

console.log("hey")

try {

	console.log(parseListHunkToTree(`- 2025/03/03 ~ 2025/03/09
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
