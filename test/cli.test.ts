import { describe, test, expect, beforeAll, beforeEach, afterEach } from "bun:test";
import { $ } from "bun";
import { existsSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join, dirname, resolve } from "path";

const CLI = resolve(import.meta.dir, "..", "src", "cli.ts");

interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

async function runCli(args: string[], env: Record<string, string>): Promise<RunResult> {
  const proc = Bun.spawn(["bun", "run", CLI, ...args], {
    env: { ...process.env, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  return { stdout, stderr, exitCode };
}

function makeRootSandbox() {
  const root = mkdtempSync(join(tmpdir(), "cronctl-cli-"));
  const env = {
    CRONCTL_CONFIG_DIR: join(root, "cronctl"),
    CRONCTL_SYSTEMD_DIR: join(root, "systemd"),
    CRONCTL_DRY_RUN: "1",
  };
  return {
    root,
    env,
    cleanup() { try { rmSync(root, { recursive: true, force: true }); } catch {} },
  };
}

function writeSampleScript(dir: string, name = "hello.ts") {
  const p = join(dir, name);
  writeFileSync(p, `console.log("hello from ${name}");\n`);
  return p;
}

describe("cronctl CLI", () => {
  let sb: ReturnType<typeof makeRootSandbox>;
  beforeEach(() => { sb = makeRootSandbox(); });
  afterEach(() => { sb.cleanup(); });

  describe("--help", () => {
    test("top-level --help prints usage and lists every command", async () => {
      const r = await runCli(["--help"], sb.env);
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toContain("Usage: cronctl");
      for (const cmd of ["add", "new", "rename", "remove", "schedule", "list", "run", "edit", "enable", "disable", "toggle", "logs", "tui", "describe", "tag"]) {
        expect(r.stdout).toContain(cmd);
      }
    });

    test("top-level --help includes quick-start and schedule formats", async () => {
      const r = await runCli(["--help"], sb.env);
      expect(r.stdout).toContain("Quick start");
      expect(r.stdout).toContain("Schedule formats");
      expect(r.stdout).toContain("every 5 minutes");
      expect(r.stdout).toContain("daily at 3am");
    });

    const SUBCOMMANDS = [
      "add", "new", "rename", "remove", "schedule", "list", "run", "edit",
      "enable", "disable", "toggle", "logs", "tui", "describe", "tag",
    ];
    for (const cmd of SUBCOMMANDS) {
      test(`'${cmd} --help' prints a usage line and exits 0`, async () => {
        const r = await runCli([cmd, "--help"], sb.env);
        expect(r.exitCode).toBe(0);
        expect(r.stdout).toMatch(/^Usage: cronctl/m);
        expect(r.stdout).toContain("-h, --help");
      });
    }

    const WITH_EXAMPLES = ["new", "add", "rename", "remove", "schedule", "logs", "tag", "describe", "tui", "run", "enable", "disable", "toggle", "edit"];
    for (const cmd of WITH_EXAMPLES) {
      test(`'${cmd} --help' includes an Examples or Keybindings section`, async () => {
        const r = await runCli([cmd, "--help"], sb.env);
        expect(r.stdout).toMatch(/Examples?:|Keybindings|The file opened is/);
      });
    }
  });

  describe("add", () => {
    test("registers a job — writes script, meta, and unit files", async () => {
      const script = writeSampleScript(sb.root);
      const r = await runCli(["add", script, "-s", "every 5 minutes", "-d", "test job", "-t", "a,b"], sb.env);
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toContain('registered "hello"');
      expect(r.stdout).toContain("every 5 minutes");

      expect(existsSync(join(sb.env.CRONCTL_CONFIG_DIR, "scripts", "hello.ts"))).toBe(true);
      const metaPath = join(sb.env.CRONCTL_CONFIG_DIR, "meta", "hello.json");
      expect(existsSync(metaPath)).toBe(true);
      const meta = JSON.parse(readFileSync(metaPath, "utf8"));
      expect(meta.name).toBe("hello");
      expect(meta.description).toBe("test job");
      expect(meta.tags).toEqual(["a", "b"]);
      expect(meta.schedule.raw).toBe("every 5 minutes");
      expect(meta.schedule.onUnitActiveSec).toBe("5min");
      expect(meta.originalPath).toBe(script);

      expect(existsSync(join(sb.env.CRONCTL_SYSTEMD_DIR, "cronctl-hello.service"))).toBe(true);
      expect(existsSync(join(sb.env.CRONCTL_SYSTEMD_DIR, "cronctl-hello.timer"))).toBe(true);
    });

    test("fails when script does not exist", async () => {
      const r = await runCli(["add", "/tmp/does-not-exist-xyz.ts", "-s", "daily at 3am"], sb.env);
      expect(r.exitCode).not.toBe(0);
      expect(r.stderr).toContain("Script not found");
    });

    test("fails on invalid name", async () => {
      const script = writeSampleScript(sb.root);
      const r = await runCli(["add", script, "-s", "daily at 3am", "-n", "has spaces!"], sb.env);
      expect(r.exitCode).not.toBe(0);
      expect(r.stderr).toContain("Invalid name");
    });

    test("fails on duplicate name", async () => {
      const script = writeSampleScript(sb.root);
      await runCli(["add", script, "-s", "daily at 3am"], sb.env);
      const r = await runCli(["add", script, "-s", "daily at 4am"], sb.env);
      expect(r.exitCode).not.toBe(0);
      expect(r.stderr).toContain("already exists");
    });

    test("fails on unparseable schedule", async () => {
      const script = writeSampleScript(sb.root);
      const r = await runCli(["add", script, "-s", "completely nonsense input"], sb.env);
      expect(r.exitCode).not.toBe(0);
      expect(r.stderr + r.stdout).toContain("Could not parse");
    });

    test("fails when -s is missing (required option)", async () => {
      const script = writeSampleScript(sb.root);
      const r = await runCli(["add", script], sb.env);
      expect(r.exitCode).not.toBe(0);
    });

    test("-n sets a custom job name", async () => {
      const script = writeSampleScript(sb.root);
      await runCli(["add", script, "-s", "daily at 3am", "-n", "custom_name"], sb.env);
      expect(existsSync(join(sb.env.CRONCTL_CONFIG_DIR, "meta", "custom_name.json"))).toBe(true);
    });

    test("--no-enable skips enabling", async () => {
      const script = writeSampleScript(sb.root);
      const r = await runCli(["add", script, "-s", "daily at 3am", "--no-enable"], sb.env);
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toContain("registered (disabled)");
    });
  });

  describe("list", () => {
    test("says '(no jobs)' when empty", async () => {
      const r = await runCli(["list"], sb.env);
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toContain("no jobs");
    });

    test("lists registered jobs with schedule and tags", async () => {
      const script = writeSampleScript(sb.root);
      await runCli(["add", script, "-s", "every 10 minutes", "-d", "periodic ping", "-t", "net"], sb.env);
      const r = await runCli(["list"], sb.env);
      expect(r.stdout).toContain("hello");
      expect(r.stdout).toContain("every 10 minutes");
      expect(r.stdout).toContain("periodic ping");
      expect(r.stdout).toContain("[net]");
    });

    test("ls alias works", async () => {
      const r = await runCli(["ls"], sb.env);
      expect(r.exitCode).toBe(0);
    });
  });

  describe("schedule", () => {
    test("changes the schedule of an existing job", async () => {
      const script = writeSampleScript(sb.root);
      await runCli(["add", script, "-s", "every 5 minutes"], sb.env);
      const r = await runCli(["schedule", "hello", "daily", "at", "3am"], sb.env);
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toContain("rescheduled");
      expect(r.stdout).toContain("daily at 3am");

      const meta = JSON.parse(readFileSync(join(sb.env.CRONCTL_CONFIG_DIR, "meta", "hello.json"), "utf8"));
      expect(meta.schedule.raw).toBe("daily at 3am");
      expect(meta.schedule.onCalendar).toBe("*-*-* 03:00:00");
      expect(meta.schedule.onUnitActiveSec).toBeUndefined();

      const timer = readFileSync(join(sb.env.CRONCTL_SYSTEMD_DIR, "cronctl-hello.timer"), "utf8");
      expect(timer).toContain("OnCalendar=*-*-* 03:00:00");
      expect(timer).not.toContain("OnUnitActiveSec=");
    });

    test("fails when job does not exist", async () => {
      const r = await runCli(["schedule", "ghost", "daily", "at", "3am"], sb.env);
      expect(r.exitCode).not.toBe(0);
      expect(r.stderr).toContain("No job");
    });

    test("fails on bad schedule spec", async () => {
      const script = writeSampleScript(sb.root);
      await runCli(["add", script, "-s", "daily at 3am"], sb.env);
      const r = await runCli(["schedule", "hello", "garbage", "schedule"], sb.env);
      expect(r.exitCode).not.toBe(0);
    });
  });

  describe("describe / tag", () => {
    test("describe updates description", async () => {
      const script = writeSampleScript(sb.root);
      await runCli(["add", script, "-s", "daily at 3am"], sb.env);
      await runCli(["describe", "hello", "new", "description", "here"], sb.env);
      const meta = JSON.parse(readFileSync(join(sb.env.CRONCTL_CONFIG_DIR, "meta", "hello.json"), "utf8"));
      expect(meta.description).toBe("new description here");
    });

    test("tag replaces existing tags", async () => {
      const script = writeSampleScript(sb.root);
      await runCli(["add", script, "-s", "daily at 3am", "-t", "old"], sb.env);
      await runCli(["tag", "hello", "one,two", "three"], sb.env);
      const meta = JSON.parse(readFileSync(join(sb.env.CRONCTL_CONFIG_DIR, "meta", "hello.json"), "utf8"));
      expect(meta.tags).toEqual(["one", "two", "three"]);
    });
  });

  describe("remove", () => {
    test("removes meta, script, and units", async () => {
      const script = writeSampleScript(sb.root);
      await runCli(["add", script, "-s", "daily at 3am"], sb.env);

      const metaPath = join(sb.env.CRONCTL_CONFIG_DIR, "meta", "hello.json");
      const scriptPath = join(sb.env.CRONCTL_CONFIG_DIR, "scripts", "hello.ts");
      const timerPath = join(sb.env.CRONCTL_SYSTEMD_DIR, "cronctl-hello.timer");
      expect(existsSync(metaPath)).toBe(true);
      expect(existsSync(scriptPath)).toBe(true);
      expect(existsSync(timerPath)).toBe(true);

      const r = await runCli(["remove", "hello"], sb.env);
      expect(r.exitCode).toBe(0);
      expect(existsSync(metaPath)).toBe(false);
      expect(existsSync(scriptPath)).toBe(false);
      expect(existsSync(timerPath)).toBe(false);
    });

    test("--keep-script preserves the managed script", async () => {
      const script = writeSampleScript(sb.root);
      await runCli(["add", script, "-s", "daily at 3am"], sb.env);
      const scriptPath = join(sb.env.CRONCTL_CONFIG_DIR, "scripts", "hello.ts");
      await runCli(["remove", "hello", "--keep-script"], sb.env);
      expect(existsSync(scriptPath)).toBe(true);
    });

    test("rm alias works", async () => {
      const script = writeSampleScript(sb.root);
      await runCli(["add", script, "-s", "daily at 3am"], sb.env);
      const r = await runCli(["rm", "hello"], sb.env);
      expect(r.exitCode).toBe(0);
    });

    test("fails on unknown job", async () => {
      const r = await runCli(["remove", "ghost"], sb.env);
      expect(r.exitCode).not.toBe(0);
    });
  });

  describe("enable / disable / toggle", () => {
    test("enable/disable/toggle don't throw on existing job", async () => {
      const script = writeSampleScript(sb.root);
      await runCli(["add", script, "-s", "daily at 3am", "--no-enable"], sb.env);
      expect((await runCli(["enable", "hello"], sb.env)).exitCode).toBe(0);
      expect((await runCli(["disable", "hello"], sb.env)).exitCode).toBe(0);
      expect((await runCli(["toggle", "hello"], sb.env)).exitCode).toBe(0);
    });

    test("fail on unknown job", async () => {
      expect((await runCli(["enable", "ghost"], sb.env)).exitCode).not.toBe(0);
      expect((await runCli(["disable", "ghost"], sb.env)).exitCode).not.toBe(0);
      expect((await runCli(["toggle", "ghost"], sb.env)).exitCode).not.toBe(0);
    });
  });

  describe("new", () => {
    test("creates a disabled job with auto-generated name and template script", async () => {
      const r = await runCli(["new", "--no-open"], sb.env);
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toContain('created "new-1"');
      expect(r.stdout).toContain("disabled");
      const scriptPath = join(sb.env.CRONCTL_CONFIG_DIR, "scripts", "new-1.ts");
      expect(existsSync(scriptPath)).toBe(true);
      const body = readFileSync(scriptPath, "utf8");
      expect(body).toContain("#!/usr/bin/env bun");
      expect(body).toContain("cronctl job: new-1");
    });

    test("auto-name increments when new-1 is taken", async () => {
      await runCli(["new", "--no-open"], sb.env);
      await runCli(["new", "--no-open"], sb.env);
      const meta2 = JSON.parse(readFileSync(join(sb.env.CRONCTL_CONFIG_DIR, "meta", "new-2.json"), "utf8"));
      expect(meta2.name).toBe("new-2");
    });

    test("accepts --name, --schedule, --description, --tags", async () => {
      const r = await runCli(["new", "--no-open", "-n", "my-job", "-s", "every 5 minutes", "-d", "my desc", "-t", "a,b"], sb.env);
      expect(r.exitCode).toBe(0);
      const meta = JSON.parse(readFileSync(join(sb.env.CRONCTL_CONFIG_DIR, "meta", "my-job.json"), "utf8"));
      expect(meta.description).toBe("my desc");
      expect(meta.tags).toEqual(["a", "b"]);
      expect(meta.schedule.raw).toBe("every 5 minutes");
    });

    test("--enable enables immediately", async () => {
      const r = await runCli(["new", "--no-open", "--enable"], sb.env);
      expect(r.stdout).toContain("enabled");
    });

    test("fails on duplicate name", async () => {
      await runCli(["new", "--no-open", "-n", "dup"], sb.env);
      const r = await runCli(["new", "--no-open", "-n", "dup"], sb.env);
      expect(r.exitCode).not.toBe(0);
      expect(r.stderr).toContain("already exists");
    });

    test("fails on invalid name", async () => {
      const r = await runCli(["new", "--no-open", "-n", "bad name!"], sb.env);
      expect(r.exitCode).not.toBe(0);
    });

    test("writes systemd units", async () => {
      await runCli(["new", "--no-open", "-n", "unitjob"], sb.env);
      expect(existsSync(join(sb.env.CRONCTL_SYSTEMD_DIR, "cronctl-unitjob.service"))).toBe(true);
      expect(existsSync(join(sb.env.CRONCTL_SYSTEMD_DIR, "cronctl-unitjob.timer"))).toBe(true);
    });
  });

  describe("rename", () => {
    test("renames meta, script, and units", async () => {
      await runCli(["new", "--no-open", "-n", "oldname", "-d", "preserved"], sb.env);
      const r = await runCli(["rename", "oldname", "newname"], sb.env);
      expect(r.exitCode).toBe(0);
      expect(r.stdout).toContain("oldname");
      expect(r.stdout).toContain("newname");

      // Old artifacts gone
      expect(existsSync(join(sb.env.CRONCTL_CONFIG_DIR, "meta", "oldname.json"))).toBe(false);
      expect(existsSync(join(sb.env.CRONCTL_CONFIG_DIR, "scripts", "oldname.ts"))).toBe(false);
      expect(existsSync(join(sb.env.CRONCTL_SYSTEMD_DIR, "cronctl-oldname.service"))).toBe(false);
      expect(existsSync(join(sb.env.CRONCTL_SYSTEMD_DIR, "cronctl-oldname.timer"))).toBe(false);

      // New artifacts present
      const meta = JSON.parse(readFileSync(join(sb.env.CRONCTL_CONFIG_DIR, "meta", "newname.json"), "utf8"));
      expect(meta.name).toBe("newname");
      expect(meta.description).toBe("preserved");
      expect(meta.scriptPath).toContain("newname.ts");
      expect(existsSync(join(sb.env.CRONCTL_CONFIG_DIR, "scripts", "newname.ts"))).toBe(true);
      expect(existsSync(join(sb.env.CRONCTL_SYSTEMD_DIR, "cronctl-newname.service"))).toBe(true);
      expect(existsSync(join(sb.env.CRONCTL_SYSTEMD_DIR, "cronctl-newname.timer"))).toBe(true);
    });

    test("preserves script body", async () => {
      await runCli(["new", "--no-open", "-n", "foo"], sb.env);
      const scriptPath = join(sb.env.CRONCTL_CONFIG_DIR, "scripts", "foo.ts");
      writeFileSync(scriptPath, "// custom user edits\nconsole.log('x');\n");
      await runCli(["rename", "foo", "bar"], sb.env);
      const body = readFileSync(join(sb.env.CRONCTL_CONFIG_DIR, "scripts", "bar.ts"), "utf8");
      expect(body).toContain("// custom user edits");
    });

    test("fails when source job does not exist", async () => {
      const r = await runCli(["rename", "ghost", "whatever"], sb.env);
      expect(r.exitCode).not.toBe(0);
      expect(r.stderr).toContain("No job");
    });

    test("fails when target name is taken", async () => {
      await runCli(["new", "--no-open", "-n", "a"], sb.env);
      await runCli(["new", "--no-open", "-n", "b"], sb.env);
      const r = await runCli(["rename", "a", "b"], sb.env);
      expect(r.exitCode).not.toBe(0);
      expect(r.stderr).toContain("already exists");
    });

    test("fails on invalid target name", async () => {
      await runCli(["new", "--no-open", "-n", "good"], sb.env);
      const r = await runCli(["rename", "good", "bad name"], sb.env);
      expect(r.exitCode).not.toBe(0);
    });

    test("fails when renaming to same name", async () => {
      await runCli(["new", "--no-open", "-n", "same"], sb.env);
      const r = await runCli(["rename", "same", "same"], sb.env);
      expect(r.exitCode).not.toBe(0);
    });
  });

  describe("full lifecycle", () => {
    test("add → list → schedule → describe → tag → remove", async () => {
      const script = writeSampleScript(sb.root);
      expect((await runCli(["add", script, "-s", "every 5 minutes"], sb.env)).exitCode).toBe(0);
      expect((await runCli(["list"], sb.env)).stdout).toContain("every 5 minutes");
      expect((await runCli(["schedule", "hello", "daily", "at", "3am"], sb.env)).exitCode).toBe(0);
      expect((await runCli(["describe", "hello", "real", "work"], sb.env)).exitCode).toBe(0);
      expect((await runCli(["tag", "hello", "prod"], sb.env)).exitCode).toBe(0);
      const listOut = (await runCli(["list"], sb.env)).stdout;
      expect(listOut).toContain("daily at 3am");
      expect(listOut).toContain("real work");
      expect(listOut).toContain("[prod]");
      expect((await runCli(["remove", "hello"], sb.env)).exitCode).toBe(0);
      expect((await runCli(["list"], sb.env)).stdout).toContain("no jobs");
    });
  });
});
