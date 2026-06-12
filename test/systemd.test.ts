import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { makeSandbox } from "./helpers";
import {
  unitNames, writeUnits, removeUnits,
  enableTimer, disableTimer, startService, daemonReload, isEnabled, isActive, listTimers,
} from "../src/systemd";
import { paths } from "../src/paths";
import type { JobMeta } from "../src/types";
import type { ScheduleSpec } from "../src/schedule";

function meta(overrides: Partial<JobMeta> = {}): JobMeta {
  return {
    name: "demo",
    description: "a test job",
    tags: ["nightly", "backup"],
    scriptPath: "/home/test/.config/cronctl/scripts/demo.ts",
    originalPath: "/home/test/src/demo.ts",
    schedule: { raw: "daily at 3am", onCalendar: "*-*-* 03:00:00" },
    createdAt: "2026-04-20T00:00:00.000Z",
    ...overrides,
  };
}

function spec(overrides: Partial<ScheduleSpec> = {}): ScheduleSpec {
  return {
    raw: "daily at 3am",
    onCalendar: "*-*-* 03:00:00",
    description: "daily at 3am",
    ...overrides,
  };
}

describe("unitNames", () => {
  test("returns service and timer with cronctl- prefix", () => {
    expect(unitNames("foo")).toEqual({
      service: "cronctl-foo.service",
      timer: "cronctl-foo.timer",
    });
  });
});

describe("writeUnits", () => {
  let sb: ReturnType<typeof makeSandbox>;
  beforeEach(() => { sb = makeSandbox(); });
  afterEach(() => { sb.cleanup(); });

  test("creates systemd dir if missing", () => {
    expect(existsSync(paths.systemdUserDir)).toBe(false);
    writeUnits(meta(), spec());
    expect(existsSync(paths.systemdUserDir)).toBe(true);
  });

  test("writes service file with Type=oneshot and ExecStart", () => {
    writeUnits(meta(), spec());
    const svc = readFileSync(join(paths.systemdUserDir, "cronctl-demo.service"), "utf8");
    expect(svc).toContain("Type=oneshot");
    expect(svc).toContain("ExecStart=");
    expect(svc).toContain("bun run /home/test/.config/cronctl/scripts/demo.ts");
    expect(svc).toContain("[Unit]");
    expect(svc).toContain("[Service]");
  });

  test("service description uses name + job description", () => {
    writeUnits(meta({ description: "nightly backup of foo" }), spec());
    const svc = readFileSync(join(paths.systemdUserDir, "cronctl-demo.service"), "utf8");
    expect(svc).toContain("Description=cronctl: demo — nightly backup of foo");
  });

  test("service description omits dash when description is empty", () => {
    writeUnits(meta({ description: "" }), spec());
    const svc = readFileSync(join(paths.systemdUserDir, "cronctl-demo.service"), "utf8");
    expect(svc).toMatch(/^Description=cronctl: demo$/m);
  });

  test("service includes tags in comment when present", () => {
    writeUnits(meta({ tags: ["nightly", "backup"] }), spec());
    const svc = readFileSync(join(paths.systemdUserDir, "cronctl-demo.service"), "utf8");
    expect(svc).toContain("# Tags: nightly, backup");
  });

  test("service omits tags comment when empty", () => {
    writeUnits(meta({ tags: [] }), spec());
    const svc = readFileSync(join(paths.systemdUserDir, "cronctl-demo.service"), "utf8");
    expect(svc).not.toContain("# Tags:");
  });

  test("timer file with OnCalendar schedule", () => {
    writeUnits(meta(), spec({ onCalendar: "*-*-* 03:00:00" }));
    const t = readFileSync(join(paths.systemdUserDir, "cronctl-demo.timer"), "utf8");
    expect(t).toContain("OnCalendar=*-*-* 03:00:00");
    expect(t).toContain("Unit=cronctl-demo.service");
    expect(t).toContain("Persistent=true");
    expect(t).toContain("WantedBy=timers.target");
  });

  test("timer file with OnUnitActiveSec (interval)", () => {
    writeUnits(meta(), spec({ raw: "every 5 minutes", onCalendar: undefined, onUnitActiveSec: "5min", onBootSec: "30s", description: "every 5 minutes" }));
    const t = readFileSync(join(paths.systemdUserDir, "cronctl-demo.timer"), "utf8");
    expect(t).toContain("OnUnitActiveSec=5min");
    expect(t).toContain("OnBootSec=30s");
    expect(t).not.toContain("OnCalendar=");
  });

  test("timer file with both OnCalendar and OnUnitActiveSec if provided", () => {
    writeUnits(meta(), spec({ onCalendar: "daily", onUnitActiveSec: "1h" }));
    const t = readFileSync(join(paths.systemdUserDir, "cronctl-demo.timer"), "utf8");
    expect(t).toContain("OnCalendar=daily");
    expect(t).toContain("OnUnitActiveSec=1h");
  });

  test("timer description uses spec description", () => {
    writeUnits(meta(), spec({ description: "every 5 minutes" }));
    const t = readFileSync(join(paths.systemdUserDir, "cronctl-demo.timer"), "utf8");
    expect(t).toContain("Description=cronctl timer: demo (every 5 minutes)");
  });

  test("schedule comment preserves raw input", () => {
    writeUnits(meta(), spec({ raw: "weekdays at 9am", description: "weekdays at 09:00" }));
    const t = readFileSync(join(paths.systemdUserDir, "cronctl-demo.timer"), "utf8");
    expect(t).toContain("# Schedule: weekdays at 9am");
  });

  test("overwrites existing unit files", () => {
    writeUnits(meta(), spec({ onCalendar: "daily" }));
    writeUnits(meta(), spec({ onCalendar: "weekly" }));
    const t = readFileSync(join(paths.systemdUserDir, "cronctl-demo.timer"), "utf8");
    expect(t).toContain("OnCalendar=weekly");
    expect(t).not.toContain("OnCalendar=daily");
  });

  test("handles names with underscores and hyphens", () => {
    writeUnits(meta({ name: "my_backup-job" }), spec());
    expect(existsSync(join(paths.systemdUserDir, "cronctl-my_backup-job.service"))).toBe(true);
    expect(existsSync(join(paths.systemdUserDir, "cronctl-my_backup-job.timer"))).toBe(true);
  });
});

describe("removeUnits", () => {
  let sb: ReturnType<typeof makeSandbox>;
  beforeEach(() => { sb = makeSandbox(); });
  afterEach(() => { sb.cleanup(); });

  test("deletes both service and timer files", async () => {
    writeUnits(meta(), spec());
    const svc = join(paths.systemdUserDir, "cronctl-demo.service");
    const tm = join(paths.systemdUserDir, "cronctl-demo.timer");
    expect(existsSync(svc)).toBe(true);
    expect(existsSync(tm)).toBe(true);
    await removeUnits("demo");
    expect(existsSync(svc)).toBe(false);
    expect(existsSync(tm)).toBe(false);
  });

  test("tolerates missing files", async () => {
    await expect(removeUnits("never-existed")).resolves.toBeUndefined();
  });
});

describe("dry-run suppresses systemctl calls", () => {
  let sb: ReturnType<typeof makeSandbox>;
  beforeEach(() => { sb = makeSandbox(); });
  afterEach(() => { sb.cleanup(); });

  test("daemonReload returns without calling systemctl", async () => {
    await expect(daemonReload()).resolves.toBeUndefined();
  });

  test("enableTimer returns without throwing even for nonexistent unit", async () => {
    await expect(enableTimer("phantom")).resolves.toBeUndefined();
  });

  test("disableTimer returns without throwing", async () => {
    await expect(disableTimer("phantom")).resolves.toBeUndefined();
  });

  test("startService returns without throwing", async () => {
    await expect(startService("phantom")).resolves.toBeUndefined();
  });

  test("isEnabled / isActive return false in dry-run", async () => {
    expect(await isEnabled("phantom")).toBe(false);
    expect(await isActive("phantom")).toBe(false);
  });

  test("listTimers returns [] in dry-run", async () => {
    expect(await listTimers()).toEqual([]);
  });
});
