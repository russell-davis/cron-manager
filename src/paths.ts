import { homedir } from "os";
import { join } from "path";

/**
 * Paths are resolved lazily so tests can override via env vars:
 *   CRONCTL_CONFIG_DIR   — overrides ~/.config/cronctl
 *   CRONCTL_SYSTEMD_DIR  — overrides ~/.config/systemd/user
 *   CRONCTL_DRY_RUN=1    — systemctl calls become no-ops (tests)
 */
export const paths = {
  get configDir(): string {
    return process.env.CRONCTL_CONFIG_DIR || join(homedir(), ".config", "cronctl");
  },
  get scriptsDir(): string {
    return join(this.configDir, "scripts");
  },
  get metaDir(): string {
    return join(this.configDir, "meta");
  },
  get systemdUserDir(): string {
    return process.env.CRONCTL_SYSTEMD_DIR || join(homedir(), ".config", "systemd", "user");
  },
};

export const UNIT_PREFIX = "cronctl-";

export function isDryRun(): boolean {
  return process.env.CRONCTL_DRY_RUN === "1";
}
