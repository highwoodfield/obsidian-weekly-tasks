// TODO: MDListLine でこのパースも終わらせる
const REGEX_CHECKBOX = /^\[(.)] (.+)$/
const CHECKBOX_UNDONE = " "

export class MDListHunk {
  lines: MDListLine[]

  constructor(lines: MDListLine[]) {
    this.lines = Array.from(lines);
  }
}

const REGEX_MD_LIST_WITH_CONTENT = /^(\s*)-\s+(.+)$/;
const REGEX_MD_LIST_EMPTY = /^(\s*)-$/;

export class MDListLine {
  readonly srcFile: SourceFile;
  readonly rawText: string;
  readonly indentCharLen: number;
  readonly content: string;

  constructor(srcFile: SourceFile, rawText: string, indentCharLen: number, content: string) {
    this.srcFile = srcFile;
    this.rawText = rawText;
    this.indentCharLen = indentCharLen;
    this.content = content;
  }

  // TODO: '-' が含まれていなければ即 undefined を返すことで多少パフォーマンスが良くなるかもしれない。
  static fromLine(srcFile: SourceFile, text: string): MDListLine | undefined {
    const matchWithContent = text.match(REGEX_MD_LIST_WITH_CONTENT);
    if (matchWithContent) {
      return new MDListLine(srcFile, text, matchWithContent[1].length, matchWithContent[2]);
    }
    const matchEmpty = text.match(REGEX_MD_LIST_EMPTY);
    if (matchEmpty) {
      return new MDListLine(srcFile, text, matchEmpty[1].length, "");
    }
    return undefined;
  }

  getIndentLevel(step: number) {
    if (this.indentCharLen % step !== 0) return undefined;
    return this.indentCharLen / step;
  }

  toNode() {
    return new MDListNode(undefined, this.srcFile, this.content);
  }
}

export class SourceFile {
  /**
   * ファイルを開くためのURI
   */
  readonly openURI: string;
  /**
   * 表示名。収集するパスからの相対パスを想定
   */
  readonly displayName: string;

  constructor(openURI: string, displayName: string) {
    this.openURI = openURI;
    this.displayName = displayName;
  }
}

// TODO: TaskTreeみたいな名前にするか、そういう名前の新しいクラスを作って、メンバをもっと秘匿したい。
export class MDListNode {
  parent: MDListNode | undefined;
  srcFile: SourceFile;
  text: string;
  checkText: string | undefined = undefined;
  children: MDListNode[] = [];

  constructor(parent: MDListNode | undefined, srcFile: SourceFile, text: string) {
    this.parent = parent;
    this.srcFile = srcFile;
    this.text = text;

    const checkboxInfo = parseCheckBox(text);
    if (checkboxInfo) {
      this.checkText = checkboxInfo[0];
      this.text = checkboxInfo[1];
      //console.log(text, this.checkText, this.text);
    }
  }

  get rawText(): string {
    return `[${this.checkText}] ${this.text}`;
  }

  visit<CtxType>(visitor: MDNodeVisitor<CtxType>, ctx: CtxType) {
    const childrenCtxGenerator = visitor.enter(this, ctx);
    const childrenCtx: CtxType[] = [];
    this.children.forEach(value => {
      const childCtx = childrenCtxGenerator();
      value.visit(visitor, childCtx);
      childrenCtx.push(childCtx);
    });
    visitor.exit(this, ctx, childrenCtx);
  }

  /**
   * If any of child nodes has unchecked checkbox, returns false.
   * Otherwise, returns the state of the top node.
   * If the top node doesn't have checkbox, it is treated as unchecked.
   */
  isAllChecked(): boolean {
    const hasUncheckedRecurse = (node: MDListNode): boolean | undefined => {
      for (const child of node.children) {
        const childResult = hasUncheckedRecurse(child);
        if (childResult !== undefined && childResult) return true;
      }
      return node.checkText === undefined
        ? undefined
        : node.checkText === CHECKBOX_UNDONE;
    }
    const hasUnchecked = hasUncheckedRecurse(this);
    if (hasUnchecked !== undefined && hasUnchecked) {
      return false;
    } else {
      return this.checkText !== undefined && this.checkText !== CHECKBOX_UNDONE;
    }
  }

  generateMarkdown(initialIndentLevel: number): string {
    const generator = new MarkdownGenerator();
    this.visit(generator, initialIndentLevel);
    return generator.getMarkdown();
  }
}

export class MDListRootNode extends MDListNode {
  constructor() {
    super(undefined, new SourceFile("ROOT", "ROOT"), "ROOT");
  }
}

export interface MDNodeVisitor<CtxType> {
  /**
   * @param node 現在のノード
   * @param ctx 親から渡されたコンテクスト
   * @return 子に渡すコンテクストを生成する関数
   */
  enter(node: MDListNode, ctx: CtxType): () => CtxType;

  /**
   *
   * @param node 現在のノード
   * @param parentCtx 親から渡されたコンテクスト
   * @param childrenCtx 子に渡したコンテクスト
   */
  exit(node: MDListNode, parentCtx: CtxType, childrenCtx: CtxType[]): void;
}

type IndentLevel = number;

class MarkdownGenerator implements MDNodeVisitor<IndentLevel> {
  private markdown: string = "";

  getMarkdown() {
    return this.markdown;
  }

  enter(node: MDListNode, ctx: IndentLevel): () => IndentLevel {
    for (let i = 0; i < ctx; i++) {
      this.markdown += "  ";
    }
    this.markdown += "- " + node.rawText + "\n";
    return function () {
      return ctx + 1;
    };
  }

  exit(node: MDListNode, parentCtx: IndentLevel, childrenCtx: IndentLevel[]): void {
    // no-op
  }
}


export function parseContentToListHunks(srcFile: SourceFile, content: string): MDListHunk[] {
  const buffer: MDListLine[] = []
  const hunks: MDListHunk[] = [];
  for (const line of content.split("\n")) {
    const mdListLine = MDListLine.fromLine(srcFile, line);
    // Flush
    if (buffer.length !== 0 && !mdListLine) {
      hunks.push(new MDListHunk(buffer));
      buffer.splice(0);
    }
    if (mdListLine) {
      buffer.push(mdListLine);
    }
  }
  hunks.push(new MDListHunk(buffer));

  return hunks;
}

export function parseListHunkToTree(srcFile: SourceFile, lines: MDListLine[]): MDListNode {
  const indentStep = getMinimumIndentStep(lines);

  const root = new MDListRootNode();
  let lastNode: MDListNode = root;
  let lastIndentLevel = -1;
  for (const line of lines) {
    const node = line.toNode();

    const indentLevel = line.getIndentLevel(indentStep);
    if (indentLevel === undefined) {
      throw parseError(srcFile, "Malformed indentation")
    }
    if (indentLevel - lastIndentLevel > 1) {
      throw parseError(srcFile, "Indent level increased: from " + lastIndentLevel + " to " + indentLevel);
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

function parseError(srcFile: SourceFile, msg: string) {
  return new Error(srcFile.displayName + ": Unable to parse: " + msg);
}
export function getMinimumIndentStep(lines: MDListLine[]) {
  let min = -1;
  for (const line of lines) {
    if (line.indentCharLen === 0) continue;
    if (min === -1 || line.indentCharLen < min) min = line.indentCharLen;
  }
  return min === -1 ? 2 : min;
}

export function parseCheckBox(text: string): [check: string, content: string] | undefined {
  const match = text.match(REGEX_CHECKBOX);
  if (!match) return undefined;
  return [match[1], match[2]];
}
