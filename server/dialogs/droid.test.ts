import { describe, expect, it } from "bun:test";

import { answerKeys, parseInteractivePrompt } from "../prompt.ts";
import { parsedByPublicPrompt } from "./shared.ts";
import { droidApprovalShown, droidAskShown } from "./droid.ts";

/**
 * The dialog as droid 1.1.0 drew it in a narrow pane: the heading and the command sit above the
 * box, the wrapped "always allow" label starts again at the box rule, and the footer names the
 * keys in the TUI's localised words. The cursor is colour-only, which text does not carry.
 */
const SCREEN = [
  "   Hooks PreToolUse → 1 已完成",
  "   Execute rtk ls -la /tmp/droid-approval-n...",
  "",
  "  待批准的命令 · 高风险",
  "  ↳ rtk ls -la /tmp/droi...ing 2>/dev/null | head -50",
  "╭───────────────────────────────────────────────────╮",
  "│  Yes, allow                                       │",
  "│  Yes, and always allow high impact commands (all  │",
  "│commands)                                          │",
  "│  No, cancel                                       │",
  "╰───────────────────────────────────────────────────╯",
  "  ↑↓ 导航，Enter 选择，Esc 取消   按 Alt/Option+E …",
  "",
  " Auto (中) · 允许… DeepSeek V4.1 Flash · 身边云 (高)",
].join("\n");

describe("droid permission prompt", () => {
  it("reads the heading, the command and every row, folding a wrapped label", () => {
    const card = parseInteractivePrompt("droid", SCREEN);
    expect(card).not.toBeNull();
    expect(card!.agent).toBe("droid");
    expect(card!.kind).toBe("approval");
    expect(card!.title).toBe("待批准的命令 · 高风险");
    expect(card!.body).toBe("rtk ls -la /tmp/droi...ing 2>/dev/null | head -50");
    expect(card!.options.map((option) => option.label)).toEqual([
      "Yes, allow",
      "Yes, and always allow high impact commands (all commands)",
      "No, cancel",
    ]);
  });

  it("answers by resetting to the first row, since the screen carries no cursor to aim at", () => {
    const card = parseInteractivePrompt("droid", SCREEN)!;
    const keys = (index: number) => answerKeys(card, { option_index: index }).flatMap((step) => step.keys ?? []);
    expect(keys(0)).toEqual([...Array(8).fill("up"), "enter"]);
    expect(keys(1)).toEqual([...Array(8).fill("up"), "down", "enter"]);
    // the last row is droid's cancel: Esc closes it where it stands
    expect(keys(2)).toEqual(["esc"]);
  });

  it("is live only while its footer is the dialog's last line", () => {
    expect(droidApprovalShown(SCREEN)).toBe(true);
    expect(droidApprovalShown(`${SCREEN}\n\n   done\n\n⛬  done\n\n Auto (中) · 允许…\n\n╭───╮`)).toBe(false);
    // another list with the same keys is not this dialog
    expect(droidApprovalShown(["  ↑↓ 导航，Enter 选择，Esc 取消", "│  Yes", "│  No"].join("\n"))).toBe(false);
  });
});

const SINGLE_SCREEN = [
  "   Ask User",
  "   喜欢什么颜色？",
  "",
  "   1. 红",
  "   2. 蓝",
  "   或输入您自己的答案...",
  "",
  "   ↑/↓ 导航 • Space/Enter/1–9 选择 • ESC 停止智能体",
].join("\n");

const EDIT_SCREEN = [
  "   Ask User",
  "   喜欢什么颜色？",
  "",
  "   1. 红",
  "   2. 蓝",
  "   紫色",
  "",
  "   Enter 提交答案 • ⇧Enter 换行 • ↑ 返回选项 • ESC",
  "   停止智能体",
].join("\n");

const ASK_SCREEN = [
  "   Ask User",
  "   ● 工作方式 → ○ 今日事项 → ○ 回复风格",
  "",
  "   这是多选测试，你今天可能想做的事情（可多选）",
  "",
  "   1. 整理笔记文档",
  "   2. 排查环境问题",
  "   3. 写脚本自动化",
  "   4. 都没打算",
  "   或输入您自己的答案...",
  "",
  "   Tab/⇧Tab 或 ←/→ 切换问题 • ↑/↓ 导航 •",
  "   Space/Enter/1–9 选择 • ESC 停止智能体",
].join("\n");

describe("droid AskUser questionnaire", () => {
  it("reads the current question, its tabs and numbered rows", () => {
    const card = parseInteractivePrompt("droid", ASK_SCREEN)!;
    expect(card).not.toBeNull();
    expect(card.kind).toBe("question");
    expect(card.title).toBe("Question 2 of 3");
    expect(card.question).toBe("这是多选测试，你今天可能想做的事情（可多选）");
    expect(card.options.map((option) => option.label)).toEqual(["整理笔记文档", "排查环境问题", "写脚本自动化", "都没打算", "Type your own answer"]);
    expect(card.custom_option_index).toBe(4);
  });

  it("types a free-text answer into droid's own row and submits it", () => {
    const card = parseInteractivePrompt("droid", ASK_SCREEN)!;
    expect(answerKeys(card, { custom_text: "绿色" })).toEqual([
      { keys: ["down"] }, { keys: ["down"] }, { keys: ["down"] }, { keys: ["down"] },
      { text: "绿色" }, { keys: ["enter"] },
    ]);
  });

  it("answers with the row's own digit, which submits it", () => {
    const card = parseInteractivePrompt("droid", ASK_SCREEN)!;
    const keys = (index: number) => answerKeys(card, { option_index: index }).flatMap((step) => step.keys ?? []);
    expect(keys(0)).toEqual(["1"]);
    expect(keys(2)).toEqual(["3"]);
  });

  it("reads a single question, drawn without the tab bar", () => {
    const card = parseInteractivePrompt("droid", SINGLE_SCREEN)!;
    expect(card).not.toBeNull();
    expect(card.title).toBe("Question");
    expect(card.question).toBe("喜欢什么颜色？");
    expect(card.options.map((option) => option.label)).toEqual(["红", "蓝", "Type your own answer"]);
    expect(card.custom_option_index).toBe(2);
    expect(droidAskShown(SINGLE_SCREEN)).toBe(true);
  });

  it("reads the free-text editor as the same question, the draft line not folded into an option", () => {
    const list = parseInteractivePrompt("droid", SINGLE_SCREEN)!;
    const editing = parseInteractivePrompt("droid", EDIT_SCREEN)!;
    expect(editing).not.toBeNull();
    expect(editing.id).toBe(list.id);
    expect(editing.options.map((option) => option.label)).toEqual(["红", "蓝", "Type your own answer"]);
    const shown = parsedByPublicPrompt.get(editing);
    expect(shown?.droidAskTyping).toBe(true);
    expect(shown?.selectedIndex).toBe(2);
    expect(answerKeys(editing, { custom_text: "紫色" })).toEqual([{ text: "紫色" }, { keys: ["enter"] }]);
    // a row's digit would land in the open editor: up leaves it for the rows first
    expect(answerKeys(editing, { option_index: 0 })).toEqual([{ keys: ["up", "1"] }]);
    expect(droidAskShown(EDIT_SCREEN)).toBe(true);
  });

  it("is live only while the footer ends the screen", () => {
    expect(droidAskShown(ASK_SCREEN)).toBe(true);
    expect(droidAskShown(`${ASK_SCREEN}\n\n done\n\n⛬  done\n\n Auto (中) · 允许…`)).toBe(false);
  });
});
