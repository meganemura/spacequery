// These tests define command lookup without starting a process.
// Temporary files isolate executable checks from the machine PATH.
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { test } from "node:test";
import * as hegel from "@hegeldev/hegel";
import * as gs from "@hegeldev/hegel/generators";
import { givenCommandPath, isExecutableFile, parseSearchPath, resolveCommandName } from "../core/search-path.ts";

test("an empty search path entry means the current directory", () => {
  assert.deepEqual(parseSearchPath(`first${delimiter}${delimiter}third`), ["first", ".", "third"]);
  assert.deepEqual(parseSearchPath(undefined), []);
});

test("command lookup returns the first executable search path entry", () => {
  const root = mkdtempSync(join(tmpdir(), "spacequery-search-path-first-"));
  const firstBin = join(root, "first");
  const secondBin = join(root, "second");
  const command = "spacequery-first-fixture";
  const firstCommand = join(firstBin, command);
  const secondCommand = join(secondBin, command);
  mkdirSync(firstBin);
  mkdirSync(secondBin);
  writeFileSync(firstCommand, "fixture\n");
  writeFileSync(secondCommand, "fixture\n");
  chmodSync(firstCommand, 0o755);
  chmodSync(secondCommand, 0o755);

  try {
    assert.equal(resolveCommandName(command, `${firstBin}${delimiter}${secondBin}`), firstCommand);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("command lookup skips a directory with the command name", () => {
  const root = mkdtempSync(join(tmpdir(), "spacequery-search-path-directory-"));
  const firstBin = join(root, "first");
  const secondBin = join(root, "second");
  const command = "spacequery-directory-fixture";
  const executable = join(secondBin, command);
  mkdirSync(join(firstBin, command), { recursive: true });
  mkdirSync(secondBin);
  writeFileSync(executable, "fixture\n");
  chmodSync(executable, 0o755);

  try {
    assert.equal(isExecutableFile(join(firstBin, command)), false);
    assert.equal(resolveCommandName(command, `${firstBin}${delimiter}${secondBin}`), executable);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a symlink to an executable file is executable", () => {
  const root = mkdtempSync(join(tmpdir(), "spacequery-search-path-symlink-"));
  const bin = join(root, "bin");
  const target = join(root, "target");
  const command = "spacequery-symlink-fixture";
  const link = join(bin, command);
  mkdirSync(bin);
  writeFileSync(target, "fixture\n");
  chmodSync(target, 0o755);
  symlinkSync(target, link);

  try {
    assert.equal(isExecutableFile(link), true);
    assert.equal(resolveCommandName(command, bin), link);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a file without execute permission is not executable", () => {
  const root = mkdtempSync(join(tmpdir(), "spacequery-search-path-permission-"));
  const command = "spacequery-permission-fixture";
  const commandPath = join(root, command);
  writeFileSync(commandPath, "fixture\n");
  chmodSync(commandPath, 0o644);

  try {
    assert.equal(isExecutableFile(commandPath), false);
    assert.equal(resolveCommandName(command, root), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a command path is resolved from its working directory", () => {
  const root = mkdtempSync(join(tmpdir(), "spacequery-search-path-given-"));
  const command = "./spacequery-given-fixture";
  const commandPath = join(root, "spacequery-given-fixture");
  writeFileSync(commandPath, "fixture\n");
  chmodSync(commandPath, 0o755);

  try {
    assert.equal(givenCommandPath(command, root), commandPath);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a generated search path resolves to its first executable match", () => {
  const root = mkdtempSync(join(tmpdir(), "spacequery-search-path-property-"));
  const command = "spacequery-property-fixture";
  const directories = Array.from({ length: 12 }, (_, index) => join(root, String(index)));
  const commands = directories.map((directory) => join(directory, command));
  for (const directory of directories) mkdirSync(directory);
  for (const executable of commands) writeFileSync(executable, "fixture\n");

  try {
    hegel.test((tc) => {
      const executableEntries = tc.draw(gs.arrays(gs.booleans(), { minSize: 1, maxSize: commands.length }));
      for (const [index, commandPath] of commands.entries()) chmodSync(commandPath, executableEntries[index] === true ? 0o755 : 0o644);
      const firstMatch = executableEntries.findIndex(Boolean);
      assert.equal(
        resolveCommandName(command, directories.slice(0, executableEntries.length).join(delimiter)),
        firstMatch === -1 ? null : commands[firstMatch],
      );
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
