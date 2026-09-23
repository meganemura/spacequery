// Config decides which providers lists and doctor treat as on.
// These tests use a temporary directory and do not start a provider.
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { disabledProviderNames, isProviderEnabled, loadConfig, providersOffByDefault, providerSummaries, saveProviderEnabled, unknownProviderWarnings } from "../core/config.ts";
import { loaders } from "../spacequery.config.ts";

function envFor(root: string): Record<string, string> {
  return { HOME: root, XDG_CONFIG_HOME: join(root, "config") };
}

test("a missing file leaves optional inventories off and core providers on", () => {
  const root = mkdtempSync(join(tmpdir(), "spacequery-config-"));
  try {
    const config = loadConfig(envFor(root));
    assert.equal(config.helpMode, "short");
    assert.deepEqual(config.overrides, {});
    assert.deepEqual(config.warnings, []);
    for (const name of providersOffByDefault) assert.equal(isProviderEnabled(name, config), false, name);
    for (const loader of loaders) {
      if (!providersOffByDefault.includes(loader.name as typeof providersOffByDefault[number])) {
        assert.equal(isProviderEnabled(loader.name, config), true, loader.name);
      }
      assert.equal(typeof providerSummaries[loader.name], "string", loader.name);
    }
    assert.deepEqual(disabledProviderNames(loaders.map((loader) => loader.name), config), [...providersOffByDefault].sort());
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("overrides replace the ship default and an unknown name is reported", () => {
  const root = mkdtempSync(join(tmpdir(), "spacequery-config-"));
  const directory = join(root, "config", "spacequery");
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "config.json"), JSON.stringify({
    providers: { beads: true, git: false, not_a_provider: false, brew: "no" },
    help: { mode: "all" },
  }));
  try {
    const config = loadConfig(envFor(root));
    assert.equal(config.helpMode, "all");
    assert.equal(isProviderEnabled("beads", config), true);
    assert.equal(isProviderEnabled("git", config), false);
    assert.equal(isProviderEnabled("brew", config), false);
    assert.equal(isProviderEnabled("herdr", config), true);
    assert.deepEqual(unknownProviderWarnings(loaders.map((loader) => loader.name), config), [
      `config ${config.path} names not_a_provider, which is not a built-in provider`,
    ]);
    assert.match(config.warnings.join("\n"), /brew/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("saving a provider keeps other keys and drops a value that matches the ship default", () => {
  const root = mkdtempSync(join(tmpdir(), "spacequery-config-"));
  const directory = join(root, "config", "spacequery");
  mkdirSync(directory, { recursive: true });
  const path = join(directory, "config.json");
  writeFileSync(path, JSON.stringify({ help: { mode: "all" }, providers: { git: false } }));
  const env = envFor(root);
  try {
    saveProviderEnabled(env, "beads", true);
    saveProviderEnabled(env, "git", true);
    const saved = JSON.parse(readFileSync(path, "utf8")) as { help: { mode: string }; providers: Record<string, boolean> };
    assert.equal(saved.help.mode, "all");
    assert.deepEqual(saved.providers, { beads: true });
    const config = loadConfig(env);
    assert.equal(isProviderEnabled("beads", config), true);
    assert.equal(isProviderEnabled("git", config), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("invalid JSON is a warning and is not replaced by a save", () => {
  const root = mkdtempSync(join(tmpdir(), "spacequery-config-"));
  const directory = join(root, "config", "spacequery");
  mkdirSync(directory, { recursive: true });
  const path = join(directory, "config.json");
  writeFileSync(path, "{");
  try {
    const config = loadConfig(envFor(root));
    assert.equal(config.helpMode, "short");
    assert.match(config.warnings.join("\n"), /not JSON/);
    assert.throws(() => saveProviderEnabled(envFor(root), "beads", true), /not JSON/);
    assert.equal(readFileSync(path, "utf8"), "{");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
