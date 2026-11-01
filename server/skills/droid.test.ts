import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { paneCommands } from "../commands.ts";
import { source } from "./droid.ts";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "droid-skills-"));
  directories.push(root);
  const home = join(root, "home");
  const cwd = join(root, "project");
  const cache = join(home, ".factory", "cache", "slash-command-catalogs");
  mkdirSync(cwd, { recursive: true });
  mkdirSync(cache, { recursive: true });
  /** Write one agent catalog; `at` sets a distinct mtime so the newest one is deterministic. */
  const catalog = (name: string, value: unknown, at = 1_000_000) => {
    const path = join(cache, name);
    writeFileSync(path, typeof value === "string" ? value : JSON.stringify(value));
    const seconds = at / 1000;
    utimesSync(path, seconds, seconds);
  };
  const commands = () => paneCommands("droid", cwd, home);
  const skills = () => commands().filter((command) => command.source === "skill");
  return { root, home, cwd, cache, catalog, commands, skills };
}

test("lists bundled and user skills from the catalog, names sanitised and duplicates dropped", () => {
  const f = fixture();
  f.catalog("session.json", {
    cwd: f.cwd,
    commands: [
      { name: "review", description: "  Review\n  carefully ", menuGroup: "factory_skills" },
      { name: "deploy", description: "Deploy it", menuGroup: "user" },
      { name: "review", description: "A duplicate", menuGroup: "user" },
      { name: "bad name", description: "never a command" },
      { name: "" },
      "not an object",
      { name: "dotted.ok", description: 7 },
      { name: "handoff", description: "A user skill with a core command's name" },
    ],
  });
  expect(f.skills().map(({ name, origin, description }) => ({ name, origin, description }))).toEqual([
    { name: "deploy", origin: "user", description: "Deploy it" },
    { name: "dotted.ok", origin: "user", description: "" },
    { name: "review", origin: "bundled", description: "Review carefully" },
  ]);
  expect(f.skills().some(({ name }) => name === "handoff")).toBe(false);
  const builtin = f.commands().find((command) => command.name === "model");
  expect(builtin?.source).toBe("builtin");
  expect(builtin?.forms?.map((form) => form.interaction)).toEqual(["terminal", "terminal"]);
});

test("prefers the catalog whose cwd is this folder, then the newest one without it", () => {
  const f = fixture();
  f.catalog("old.json", { cwd: f.cwd, commands: [{ name: "matching" }] }, 1_000_000);
  f.catalog("new.json", { cwd: join(f.root, "elsewhere"), commands: [{ name: "other" }] }, 2_000_000);
  expect(f.skills().map(({ name }) => name)).toEqual(["matching"]);

  const g = fixture();
  g.catalog("older.json", { commands: [{ name: "older" }] }, 1_000_000);
  g.catalog("newer.json", { commands: [{ name: "newer" }] }, 2_000_000);
  expect(g.skills().map(({ name }) => name)).toEqual(["newer"]);
});

test("ignores the startup file and a half-written catalog", () => {
  const f = fixture();
  f.catalog("good.json", { cwd: f.cwd, commands: [{ name: "good" }] }, 1_000_000);
  f.catalog(".startup.json", { cwd: f.cwd, commands: [{ name: "startup" }] }, 3_000_000);
  f.catalog("broken.json", "{not json", 4_000_000);
  expect(f.skills().map(({ name }) => name)).toEqual(["good"]);
});

test("lists only its builtins when the agent never wrote a catalog", () => {
  const f = fixture();
  rmSync(join(f.home, ".factory", "cache"), { recursive: true, force: true });
  expect(f.skills()).toEqual([]);
  expect(source.pin).toBe("1.1.0");
  expect(source.builtins).toContain("model");
});
