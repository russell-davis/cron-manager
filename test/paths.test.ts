import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { paths, isDryRun, UNIT_PREFIX } from "../src/paths";
import { homedir } from "os";
import { join } from "path";

describe("paths", () => {
  const originals = { ...process.env };
  beforeEach(() => { delete process.env.CRONCTL_CONFIG_DIR; delete process.env.CRONCTL_SYSTEMD_DIR; delete process.env.CRONCTL_DRY_RUN; });
  afterEach(() => { process.env = { ...originals }; });

  test("configDir defaults to ~/.config/cronctl", () => {
    expect(paths.configDir).toBe(join(homedir(), ".config", "cronctl"));
  });

  test("configDir respects CRONCTL_CONFIG_DIR env", () => {
    process.env.CRONCTL_CONFIG_DIR = "/tmp/alt";
    expect(paths.configDir).toBe("/tmp/alt");
  });

  test("scriptsDir / metaDir derive from configDir", () => {
    process.env.CRONCTL_CONFIG_DIR = "/tmp/alt";
    expect(paths.scriptsDir).toBe("/tmp/alt/scripts");
    expect(paths.metaDir).toBe("/tmp/alt/meta");
  });

  test("systemdUserDir respects CRONCTL_SYSTEMD_DIR env", () => {
    process.env.CRONCTL_SYSTEMD_DIR = "/tmp/systemd";
    expect(paths.systemdUserDir).toBe("/tmp/systemd");
  });

  test("paths are re-resolved each access (not cached)", () => {
    process.env.CRONCTL_CONFIG_DIR = "/tmp/a";
    expect(paths.configDir).toBe("/tmp/a");
    process.env.CRONCTL_CONFIG_DIR = "/tmp/b";
    expect(paths.configDir).toBe("/tmp/b");
  });

  test("isDryRun true only for exact '1'", () => {
    expect(isDryRun()).toBe(false);
    process.env.CRONCTL_DRY_RUN = "1";
    expect(isDryRun()).toBe(true);
    process.env.CRONCTL_DRY_RUN = "true";
    expect(isDryRun()).toBe(false);
    process.env.CRONCTL_DRY_RUN = "0";
    expect(isDryRun()).toBe(false);
  });

  test("UNIT_PREFIX is stable", () => {
    expect(UNIT_PREFIX).toBe("cronctl-");
  });
});
