import type { DialogReader } from "./registry.ts";
import { ANSI_RE, type CardWords, KEY, type ParsedPrompt, cleanLine, findLastIndex, finishPrompt, isDivider, keySteps, navigationKeys, own } from "./shared.ts";

/**
 * Factory's Droid CLI permission prompt (1.1.0), drawn at the bottom of the pane:
 *
 *   ╭────────────────────────────────────────────╮
 *   │ Hooks PreToolUse → 1 已完成                │
 *   │                                            │
 *   │ 待批准的命令 · 高风险                      │
 *   │                                            │
 *   │ ↳ rtk ls ~/.factory                        │
 *   │                                            │
 *   │   Yes, allow                               │
 *   │   Yes, and always allow all high-impact commands │
 *   │   No, cancel                               │
 *   │                                            │
 *   │ ↑/↓ 导航, Enter 选择, Esc 取消, Alt/Option+E 查看详情 │
 *   ╰────────────────────────────────────────────╯
 *
 * The rows carry no text cursor: droid marks the selected row with colour alone, which the
 * text screen does not carry. Every row's steps therefore reset to the top first (`↑` stops at
 * the first row, measured on 1.1.0) and step down to the row, rather than trusting a cursor the
 * bridge cannot read. The labels themselves stay English under a localised UI; the heading and
 * the footer are translated.
 */

const FOOTER_RE = /↑\s*\/?\s*↓.*?(?:enter|回车|選擇|选择).*?(?:esc|取消)/i;
const MODEL_FOOTER_RE = /(?:focus list|聚焦列表|tab switch|tab 切换)/i;

/** The line droid draws its key hints on, when it is the approval's: the model picker's own footer has ↑/↓, Enter and Esc too. */
export function droidApprovalFooterStart(lines: readonly string[]): number {
  return findLastIndex(lines as string[], (raw) => {
    const line = raw.replace(ANSI_RE, "");
    return FOOTER_RE.test(line) && !MODEL_FOOTER_RE.test(line);
  });
}

/** The footer sits over the box's bottom rule, a status line or two under it; a buried, answered dialog is history. */
function footerAtEnd(lines: readonly string[]): boolean {
  const at = droidApprovalFooterStart(lines);
  if (at < 0) return false;
  return lines.slice(at + 1).filter((line) => cleanLine(line) !== "").length <= 4;
}

type Row = { label: string; lineIndex: number };

/** The Yes…/No… rows directly above the footer, wrapped continuations folded into their row. */
function permissionRows(lines: readonly string[], footer: number): Row[] {
  const rows: Row[] = [];
  let runEnd = -1;
  for (let index = 0; index < footer; index += 1) {
    const raw = lines[index]!.replace(ANSI_RE, "");
    const rule = raw.startsWith("│") ? raw.slice(1) : raw;
    // the box's right rule is not part of a row's text, and a blank row inside the box is no row
    const inner = rule.replace(/\s*│\s*$/, "");
    // a row starts two or more columns in from the box rule; a continuation is indented further
    const match = /^\s{2,}(Yes,|No,)\s*(\S.*?)\s*$/.exec(inner);
    if (match) {
      rows.push({ label: `${match[1]} ${match[2]}`.trim(), lineIndex: index });
      runEnd = index;
      continue;
    }
    // A wrapped label starts again at the box rule itself (`│commands)`), not indented: every
    // line inside the box between two rows belongs to the row above it.
    if (rows.length > 0 && raw.startsWith("│") && index - runEnd <= 6) {
      const cont = inner.trim();
      if (cont !== "" && !/^(?:Yes,|No,)/.test(cont) && !isDivider(cont)) {
        rows.at(-1)!.label = `${rows.at(-1)!.label} ${cont}`.trim();
        runEnd = index;
      }
    }
  }
  // the last run of rows is the dialog's: a Yes/No list printed above the box is not one
  let start = rows.length;
  while (start > 0 && rows[start - 1]!.lineIndex >= footer - 12) start -= 1;
  const run = rows.slice(start);
  if (run.length < 2) return [];
  if (!/^Yes\b/.test(run[0]!.label) || !/^No\b/.test(run.at(-1)!.label)) return [];
  // the rows end at the dialog's last text line; a Yes/No list far above the footer is not this dialog
  const lastText = [...lines.slice(0, footer)].reverse().find((line) => cleanLine(line) !== "" && !isDivider(line));
  if (lastText === undefined || !/^\s*(?:Yes,|No,)/.test(lastText.replace(ANSI_RE, "").replace(/^│/, ""))) return [];
  return run;
}

function parseDroidApproval(screen: string): ParsedPrompt | null {
  const lines = screen.replace(ANSI_RE, "").split(/\r?\n/);
  const footer = droidApprovalFooterStart(lines);
  if (footer < 0 || !footerAtEnd(lines)) return null;
  const rows = permissionRows(lines, footer);
  if (rows.length === 0) return null;
  const firstRow = rows[0]!.lineIndex;
  // the heading and what droid wants to do: the ↳ line (the command) and anything under it
  const above = lines.slice(0, firstRow).map(cleanLine);
  const arrow = findLastIndex(above, (line) => /^↳/.test(line));
  let title: CardWords = own("Command approval");
  let body: string | null = null;
  if (arrow >= 0) {
    for (let index = arrow - 1; index >= 0; index -= 1) {
      const line = above[index]!;
      if (!line || isDivider(line) || /^Hooks?\b/i.test(line)) continue;
      title = line;
      break;
    }
    const text = above.slice(arrow, firstRow)
      .map((line) => line.replace(/^↳\s*/, "").trim())
      .filter((line) => line && !isDivider(line) && !/^Hooks?\b/i.test(line));
    body = text.join("\n") || null;
  } else {
    // no command line to name it: the dialog's first line is the heading, the rest what it says
    const text = above.filter((line) => line && !isDivider(line) && !/^Hooks?\b/i.test(line));
    if (text.length > 0) {
      title = text[0]!;
      body = text.slice(1).join("\n") || null;
    }
  }
  const labels = rows.map((row) => row.label);
  // ↑ stops at the first row; ↓ walks the rows one at a time (measured on 1.1.0)
  const reset = Array.from({ length: 8 }, () => KEY.up);
  const optionSteps = labels.map((_, index) => [{
    keys: index === labels.length - 1
      ? [KEY.escape]
      : [...reset, ...Array.from({ length: index }, () => KEY.down), KEY.enter],
  }]);
  const dialog = lines.slice(0, firstRow).join("\n");
  return finishPrompt("droid", {
    kind: "approval", title, question: title, body,
    options: labels.map((label) => ({ label, description: null })),
    multi_select: false,
    custom_option_index: null,
  }, {
    responder: "droid-approval",
    menuLabels: labels,
    selectedIndex: 0,
    checkedOptionIndices: [],
    customMenuIndex: null,
    rejectWithEscapeIndex: labels.length - 1,
    optionSteps,
  }, { body: dialog });
}

/** Whether the screen ends on droid's permission dialog: its footer is one of the last lines. */
export function droidApprovalShown(screen: string): boolean {
  const lines = screen.replace(ANSI_RE, "").split(/\r?\n/);
  return footerAtEnd(lines) && permissionRows(lines, droidApprovalFooterStart(lines)).length > 0;
}



/**
 * Droid's AskUser questionnaire (1.1.0), one question of it on screen at a time:
 *
 *   Ask User
 *   ● 工作方式 → ○ 今日事项 → ○ 回复风格
 *
 *   这是单选测试，你更常用哪种方式让我干活？
 *
 *   1. 直接改代码
 *   2. 先出方案再动手
 *   3. 只做分析不改文件
 *   或输入您自己的答案...
 *
 *   Tab/⇧Tab 或 ←/→ 切换问题 • ↑/↓ 导航 •
 *   Space/Enter/1–9 选择 • ESC 停止智能体
 *
 * A digit answers the question by its own number and moves to the next one (measured on 1.1.0,
 * including the second question whose wording said "可多选"): no cursor has to be read, so the
 * card's rows are the digits. The answered questions are the tabs drawn filled; the current one
 * is the first unfilled tab. The free-text row opens droid's editor once the cursor reaches it
 * (one down per option), so a card answer types there and submits it.
 */
const ASK_LIST_FOOTER_RE = /space\s*\/\s*enter\s*\/\s*1\s*[–-]\s*9/i;
/** droid's free-text editor, which replaces the list's footer once the cursor reaches its row. */
const ASK_EDIT_FOOTER_RE = /(?:提交答案|\bsubmit\b)/i;
const ASK_HEADER_RE = /^Ask\s*User\b/i;
const ASK_CUSTOM_RE = /^(?:或输入|or type your own)/i;
const ASK_TAB_RE = /[●○◉]/g;

function askFooter(lines: readonly string[]): { index: number; typing: boolean } | null {
  const index = findLastIndex(lines as string[], (raw) => {
    const line = raw.replace(ANSI_RE, "");
    return /esc/i.test(line) && (ASK_LIST_FOOTER_RE.test(line) || ASK_EDIT_FOOTER_RE.test(line));
  });
  if (index < 0) return null;
  return { index, typing: ASK_EDIT_FOOTER_RE.test(lines[index]!.replace(ANSI_RE, "")) };
}

function parseDroidAsk(screen: string): ParsedPrompt | null {
  const lines = screen.replace(ANSI_RE, "").split(/\r?\n/);
  const mark = askFooter(lines);
  if (!mark) return null;
  const { index: footer, typing } = mark;
  if (lines.slice(footer + 1).filter((line) => cleanLine(line) !== "").length > 1) return null;
  const header = findLastIndex(lines.slice(0, footer) as string[], (raw) => ASK_HEADER_RE.test(cleanLine(raw)));
  if (header < 0) return null;
  // the tab bar names every question, the answered ones filled
  let tabs = -1;
  for (let index = header + 1; index < footer; index += 1) {
    const line = cleanLine(lines[index]!);
    if (!line.includes("→")) continue;
    const glyphs = line.match(ASK_TAB_RE) ?? [];
    if (glyphs.length >= 2) { tabs = index; break; }
  }
  // a single question is drawn without the tab bar (measured on 1.1.0)
  const glyphs: string[] = tabs < 0 ? [] : cleanLine(lines[tabs]!).match(ASK_TAB_RE)!;
  const current = glyphs.length === 0 ? 0 : Math.max(0, glyphs.indexOf("○"));
  const rows: { label: string; number: number; lineIndex: number }[] = [];
  let question = "";
  let custom = typing;
  const start = tabs < 0 ? header + 1 : tabs + 1;
  // in the editor the last line before the footer is the draft (or its placeholder while empty)
  let draft = -1;
  if (typing) {
    for (let index = start; index < footer; index += 1) if (cleanLine(lines[index]!) !== "") draft = index;
    const line = draft < 0 ? "" : cleanLine(lines[draft]!);
    if (!line || /^\d+\.\s+/.test(line) || ASK_CUSTOM_RE.test(line)) draft = -1;
  }
  for (let index = start; index < footer; index += 1) {
    const line = cleanLine(lines[index]!);
    if (!line || isDivider(line)) continue;
    if (index === draft) { custom = true; continue; }
    if (ASK_CUSTOM_RE.test(line)) { custom = true; break; }
    const numbered = /^(\d+)\.\s+(.+)$/.exec(line);
    if (numbered) {
      rows.push({ label: numbered[2]!.trim(), number: Number(numbered[1]), lineIndex: index });
      continue;
    }
    if (rows.length === 0) {
      // the question, wrapped over the lines above the first option
      question = `${question} ${line}`.trim();
    } else if (index - rows.at(-1)!.lineIndex <= 4) {
      // a wrapped option label
      rows.at(-1)!.label = `${rows.at(-1)!.label} ${line}`.trim();
      rows.at(-1)!.lineIndex = index;
    }
  }
  if (!question || rows.length === 0 || rows.length > 9) return null;
  // the numbers count up from 1 in order: anything else is another list drawn above the footer
  if (!rows.every((row, index) => row.number === index + 1)) return null;
  // the editor owns the keys: up leaves it for the rows, then the row's own digit answers
  const digits = rows.map((_, index) => [{
    keys: typing ? [KEY.up, String(index + 1)] : [String(index + 1)],
  }]);
  return finishPrompt("droid", {
    kind: "question",
    title: glyphs.length <= 1 ? own("Question") : own("Question {n} of {total}", { n: current + 1, total: glyphs.length }),
    question,
    body: null,
    options: [
      ...rows.map((row) => ({ label: row.label, description: null })),
      ...(custom ? [{ label: own("Type your own answer"), description: null }] : []),
    ],
    multi_select: false,
    custom_option_index: custom ? rows.length : null,
  }, {
    responder: "droid-ask",
    menuLabels: rows.map((row) => row.label),
    // in the editor the cursor is on the free-text row; the list opens on the first option
    selectedIndex: typing ? rows.length : 0,
    checkedOptionIndices: [],
    customMenuIndex: custom ? rows.length : null,
    rejectWithEscapeIndex: null,
    optionSteps: digits,
    ...(custom ? {
      // an editor already open (a card drawn from that screen) takes the text where it is
      customSteps: (text: string) => [...(typing ? [] : keySteps(navigationKeys(rows.length))), { text }, ...keySteps([KEY.enter])],
    } : {}),
    ...(typing ? { droidAskTyping: true as const } : {}),
  });
}

/** Whether the screen ends on droid's AskUser questionnaire: its last footer line is near the bottom. */
export function droidAskShown(screen: string): boolean {
  const lines = screen.replace(ANSI_RE, "").split(/\r?\n/);
  const mark = askFooter(lines);
  if (!mark || lines.slice(mark.index + 1).filter((line) => cleanLine(line) !== "").length > 1) return false;
  return parseDroidAsk(screen) !== null;
}

export const readers: readonly DialogReader[] = [
  {
    // a digit answers the row itself; no cursor has to be aimed
    id: "droid-ask", agents: ["droid"], priority: 10,
    reread: "none", list: "none",
    parse: parseDroidAsk,
  },
  {
    // the screen carries no cursor to aim at; the rows' steps reset to the top themselves
    id: "droid-approval", agents: ["droid"], priority: 20,
    reread: "none", list: "none",
    parse: parseDroidApproval,
  },
];
