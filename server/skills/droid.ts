import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import type { CommandForm, SlashCommand } from "../../shared/protocol.ts";
import type { AgentCommandContext, AgentCommandSource } from "./index.ts";

/**
 * Factory Droid 1.1.0's slash commands.
 *
 * Its core commands are built into the binary; only the TUI menu lists them, so the names and the
 * one-line descriptions below were read off `/` in the TUI. Most open a screen the bridge cannot
 * answer (a picker, a confirmation, a full-screen report), and are listed as terminal-only rather
 * than offered as if Chat could finish them.
 *
 * Skills are not: the agent writes every skill it loaded, its own bundled ones and the person's,
 * to `~/.factory/cache/slash-command-catalogs/<hash>.json` beside a `.startup.json` that names the
 * folder. That cache is the running agent's own list, so a skill edited since the agent started is
 * listed as the agent sees it. Both bundled Factory skills and the shared ~/.agents/skills (the
 * same ones omp lists) are invoked by their bare names.
 */
const BUILTINS = [
  "account", "cd", "cwd", "droids", "fast", "skills", "hooks", "language", "login", "logout",
  "plugins", "mcp", "model", "settings", "statusline", "terminal-setup", "themes", "vim",
  "commands", "diagnostics", "limits", "context", "stats", "status", "archive", "btw", "clear",
  "copy", "compress", "handoff", "new", "favorite", "pin", "fork", "rename", "quit", "exit",
  "rewind-conversation", "sessions", "resume", "share", "tree",
] as const;

const DESCRIPTIONS: Readonly<Record<string, string>> = {
  account: "Show account information",
  cd: "Change the session's working directory",
  cwd: "Change the session's working directory",
  droids: "Manage custom Droids (subagents)",
  fast: "Toggle fast mode for the current model",
  skills: "Manage prompt-based skills",
  hooks: "Manage tool-execution hooks",
  language: "Switch the TUI display language",
  login: "Log in to Factory",
  logout: "Log out of Factory",
  plugins: "Manage plugins and the marketplace",
  mcp: "Manage MCP servers",
  model: "Open the model picker",
  settings: "Configure application settings",
  statusline: "Configure a custom status line",
  "terminal-setup": "Set up multiline input keybindings (tmux, VS Code, Cursor…)",
  themes: "Choose a color theme",
  vim: "Toggle Vim keybindings for the chat input",
  commands: "Manage custom slash commands",
  diagnostics: "Show configuration diagnostic problems",
  limits: "Manage usage limits and overage preferences",
  context: "Show the context window estimate",
  stats: "Show Droid usage statistics",
  status: "Show the current CLI status and configuration",
  archive: "Archive this session (restore it from /sessions)",
  btw: "Ask a side question without polluting the transcript",
  clear: "Clear the conversation, keeping the model and autonomy level",
  copy: "Copy a prompt, reply, range or session id",
  compress: "Compact this session, with optional instructions (alias: compact)",
  handoff: "Start a new session from a summary of this conversation",
  new: "Start a fresh session with a default model and autonomy level",
  favorite: "Pin this session for quick access",
  pin: "Pin this session for quick access (alias: favorite)",
  fork: "Fork this session",
  rename: "Rename this session",
  quit: "Exit the Droid CLI",
  exit: "Exit the Droid CLI (alias: quit)",
  "rewind-conversation": "Rewind the conversation to an earlier message",
  sessions: "List earlier sessions to resume (alias: resume)",
  resume: "Resume a session by id, or list sessions",
  share: "Share this session with your organization",
  tree: "Browse the session's fork tree",
};

const TERMINAL: CommandForm[] = [{ match: "bare", interaction: "terminal" }, { match: "other", interaction: "terminal" }];
const FORMS: Readonly<Record<string, CommandForm[]>> = Object.fromEntries(
  BUILTINS.map((name) => [name, TERMINAL]),
);

const CATALOG_NAME = /\.json$/;
const SKILL_NAME = /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/;

type Catalog = { cwd?: unknown; commands?: unknown; mtime: number };

function catalogs(configHome: string): Catalog[] {
  const dir = join(configHome, "cache", "slash-command-catalogs");
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  const found: Catalog[] = [];
  for (const name of names) {
    if (!CATALOG_NAME.test(name) || name.endsWith(".startup.json")) continue;
    const path = join(dir, name);
    try {
      const stat = statSync(path, { throwIfNoEntry: false });
      if (stat === undefined || !stat.isFile()) continue;
      const value: unknown = JSON.parse(readFileSync(path, "utf8"));
      if (value === null || typeof value !== "object" || Array.isArray(value)) continue;
      const catalog = value as Record<string, unknown>;
      found.push({ cwd: catalog.cwd, commands: catalog.commands, mtime: stat.mtimeMs });
    } catch {
      // an optional cache: a truncated or half-written file lists nothing
    }
  }
  return found.sort((left, right) => right.mtime - left.mtime);
}

function skills(configHome: string, cwd: string | null | undefined): SlashCommand[] {
  const found = catalogs(configHome);
  if (found.length === 0) return [];
  const folder = cwd === null || cwd === undefined ? null : resolve(cwd);
  const catalog = found.find((entry) => typeof entry.cwd === "string" && resolve(entry.cwd) === folder) ?? found[0]!;
  if (!Array.isArray(catalog.commands)) return [];
  const rows: SlashCommand[] = [];
  // a user skill named like a core command would list /handoff twice; the builtin is the one droid runs
  const names = new Set<string>(BUILTINS);
  for (const entry of catalog.commands) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) continue;
    const command = entry as Record<string, unknown>;
    const name = typeof command.name === "string" ? command.name.trim() : "";
    if (!SKILL_NAME.test(name) || names.has(name)) continue;
    const text = typeof command.description === "string" ? command.description.replace(/\s+/g, " ").trim() : "";
    const bundled = command.menuGroup === "factory_skills";
    names.add(name);
    rows.push({
      name,
      description: text.slice(0, 400),
      source: "skill",
      origin: bundled ? "bundled" : "user",
      id: `skill:${name}`,
    });
  }
  return rows.sort((left, right) => left.name.localeCompare(right.name));
}

export const source: AgentCommandSource = {
  builtins: BUILTINS,
  // the menu and every builtin below were read off droid 1.1.0
  pin: "1.1.0",
  descriptions: DESCRIPTIONS,
  forms: FORMS,
  // every core command opens a screen or a confirmation the bridge cannot answer; the skills are
  // the commands Chat can run itself
  terminalBound: BUILTINS,
  discover: (ctx: AgentCommandContext) => skills(join(ctx.home, ".factory"), ctx.cwd),
};
