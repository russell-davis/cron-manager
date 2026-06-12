import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

/**
 * Create an isolated env sandbox for a test.
 * Sets CRONCTL_CONFIG_DIR and CRONCTL_SYSTEMD_DIR to fresh tmp dirs,
 * and CRONCTL_DRY_RUN=1 so systemctl is not invoked.
 * Returns paths + a cleanup function.
 */
export function makeSandbox() {
  const root = mkdtempSync(join(tmpdir(), "cronctl-test-"));
  const configDir = join(root, "cronctl");
  const systemdDir = join(root, "systemd");
  const prev = {
    CRONCTL_CONFIG_DIR: process.env.CRONCTL_CONFIG_DIR,
    CRONCTL_SYSTEMD_DIR: process.env.CRONCTL_SYSTEMD_DIR,
    CRONCTL_DRY_RUN: process.env.CRONCTL_DRY_RUN,
  };
  process.env.CRONCTL_CONFIG_DIR = configDir;
  process.env.CRONCTL_SYSTEMD_DIR = systemdDir;
  process.env.CRONCTL_DRY_RUN = "1";
  return {
    root,
    configDir,
    systemdDir,
    env: {
      CRONCTL_CONFIG_DIR: configDir,
      CRONCTL_SYSTEMD_DIR: systemdDir,
      CRONCTL_DRY_RUN: "1",
    },
    cleanup() {
      if (prev.CRONCTL_CONFIG_DIR === undefined) delete process.env.CRONCTL_CONFIG_DIR;
      else process.env.CRONCTL_CONFIG_DIR = prev.CRONCTL_CONFIG_DIR;
      if (prev.CRONCTL_SYSTEMD_DIR === undefined) delete process.env.CRONCTL_SYSTEMD_DIR;
      else process.env.CRONCTL_SYSTEMD_DIR = prev.CRONCTL_SYSTEMD_DIR;
      if (prev.CRONCTL_DRY_RUN === undefined) delete process.env.CRONCTL_DRY_RUN;
      else process.env.CRONCTL_DRY_RUN = prev.CRONCTL_DRY_RUN;
      try { rmSync(root, { recursive: true, force: true }); } catch {}
    },
  };
}
