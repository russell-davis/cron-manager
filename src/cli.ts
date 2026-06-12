#!/usr/bin/env bun
import { Command } from "commander";
import { $ } from "bun";
import { resolve, basename, extname, join, dirname } from "path";
import { existsSync, writeFileSync, renameSync } from "fs";
import { parseSchedule } from "./schedule";
import { saveMeta, readMeta, listJobs, deleteMeta, importScript, deleteScript, ensureDirs } from "./store";
import {
  writeUnits, enableTimer, disableTimer, startService, removeUnits,
  listTimers, isEnabled, unitNames, daemonReload,
} from "./systemd";
import { paths } from "./paths";
import type { JobMeta } from "./types";

const program = new Command();
program
  .name("cronctl")
  .description("Simple cron manager for bespoke scripts — backed by systemd user timers")
  .version("0.1.0")
  .addHelpText("after", `
Quick start:
  $ cronctl new                            # create a new job, opens in editor
  $ cronctl tui                            # interactive dashboard
  $ cronctl list                           # show all jobs
  $ cronctl add ./my-script.ts -s "daily at 3am"

Schedule formats:
  every 5 minutes · every 2 hours · every 30 seconds
  daily at 3am · weekdays at 9am · weekends at 10am
  mon,wed,fri at 14:30 · monday at 8am
  @hourly · @daily · @weekly · @monthly
  0 3 * * *              (cron)
  *-*-* 03:00:00         (systemd OnCalendar)

Files:
  scripts:  ~/.config/cronctl/scripts/
  metadata: ~/.config/cronctl/meta/
  units:    ~/.config/systemd/user/cronctl-<name>.{service,timer}
`);

program.command("add <script>")
  .description("Register a script as a scheduled job")
  .requiredOption("-s, --schedule <spec>", "schedule: 'every 5 minutes', 'daily at 3am', cron, or OnCalendar")
  .option("-n, --name <name>", "job name (defaults to script basename)")
  .option("-d, --description <desc>", "description", "")
  .option("-t, --tags <tags>", "comma-separated tags", "")
  .option("--no-enable", "register but do not enable the timer")
  .addHelpText("after", `
Examples:
  $ cronctl add ./backup.ts -s "daily at 3am"
  $ cronctl add ./ping.ts -s "every 5 minutes" -t net
  $ cronctl add ./report.ts -s "weekdays at 9am" -d "morning status report"
  $ cronctl add ./job.ts -s "*/10 * * * *" --no-enable   # cron syntax, stay disabled

The script is copied into ~/.config/cronctl/scripts/<name>.ts — that copy is
the one that runs. Edit it with \`cronctl edit <name>\`.
`)
  .action(async (script: string, opts) => {
    const src = resolve(script);
    if (!existsSync(src)) { console.error(`Script not found: ${src}`); process.exit(1); }
    const name = opts.name ?? basename(src, extname(src));
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) { console.error(`Invalid name: ${name} (alphanumeric, -, _ only)`); process.exit(1); }
    if (readMeta(name)) { console.error(`Job "${name}" already exists. Use \`cronctl schedule ${name} ...\` to reschedule, or \`cronctl remove ${name}\`.`); process.exit(1); }

    const spec = parseSchedule(opts.schedule);
    ensureDirs();
    const scriptPath = importScript(src, name);
    const meta: JobMeta = {
      name,
      description: opts.description,
      tags: opts.tags ? opts.tags.split(",").map((t: string) => t.trim()).filter(Boolean) : [],
      scriptPath,
      originalPath: src,
      schedule: { raw: spec.raw, onCalendar: spec.onCalendar, onUnitActiveSec: spec.onUnitActiveSec, onBootSec: spec.onBootSec },
      createdAt: new Date().toISOString(),
    };
    saveMeta(meta);
    writeUnits(meta, spec);
    if (opts.enable !== false) await enableTimer(name, true);
    else await daemonReload();
    console.log(`✓ registered "${name}" — ${spec.description}`);
    console.log(`  script: ${scriptPath}`);
    console.log(`  ${opts.enable !== false ? "enabled & armed" : "registered (disabled)"}`);
  });

program.command("new")
  .description("Create a new job from a template — edit the script, then set a name / schedule / enable")
  .option("-n, --name <name>", "job name (default: auto-generated 'new-<N>')")
  .option("-s, --schedule <spec>", "initial schedule", "@daily")
  .option("-d, --description <desc>", "description", "")
  .option("-t, --tags <tags>", "comma-separated tags", "")
  .option("--enable", "enable the timer immediately", false)
  .option("--no-open", "don't open the script in $EDITOR")
  .addHelpText("after", `
Examples:
  $ cronctl new                                   # auto-name 'new-1', disabled, @daily
  $ cronctl new -n backup -s "daily at 3am"
  $ cronctl new -n ping -s "every 5 minutes" --enable -t net,health

After creating, common follow-ups:
  cronctl rename <name> <new-name>
  cronctl schedule <name> "every 2 hours"
  cronctl enable <name>
  cronctl edit <name>
`)
  .action(async (opts) => {
    ensureDirs();
    const name = opts.name ?? autoName();
    if (!/^[a-zA-Z0-9_-]+$/.test(name)) { console.error(`Invalid name: ${name}`); process.exit(1); }
    if (readMeta(name)) { console.error(`Job "${name}" already exists.`); process.exit(1); }

    const spec = parseSchedule(opts.schedule);
    const scriptPath = join(paths.scriptsDir, `${name}.ts`);
    writeFileSync(scriptPath, template(name));
    const meta: JobMeta = {
      name,
      description: opts.description,
      tags: opts.tags ? opts.tags.split(",").map((t: string) => t.trim()).filter(Boolean) : [],
      scriptPath,
      originalPath: scriptPath,
      schedule: { raw: spec.raw, onCalendar: spec.onCalendar, onUnitActiveSec: spec.onUnitActiveSec, onBootSec: spec.onBootSec },
      createdAt: new Date().toISOString(),
    };
    saveMeta(meta);
    writeUnits(meta, spec);
    if (opts.enable) await enableTimer(name, true);
    else await daemonReload();

    console.log(`✓ created "${name}" — ${opts.enable ? "enabled" : "disabled"} · ${spec.description}`);
    console.log(`  script: ${scriptPath}`);
    console.log(`  next:   cronctl rename ${name} <new-name>`);
    console.log(`          cronctl schedule ${name} <spec>`);
    console.log(`          cronctl enable ${name}`);

    if (opts.open !== false) {
      const editor = process.env.EDITOR || "code";
      await $`${editor} ${scriptPath}`.nothrow();
    }
  });

function autoName(): string {
  const jobs = listJobs();
  const taken = new Set(jobs.map(j => j.name));
  for (let i = 1; i < 10000; i++) {
    const candidate = `new-${i}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `new-${Date.now()}`;
}

function template(name: string): string {
  return `#!/usr/bin/env bun
// cronctl job: ${name}
// Edit freely. When ready: cronctl enable ${name}
// Rename:      cronctl rename ${name} <new-name>
// Reschedule:  cronctl schedule ${name} "daily at 3am"

console.log(\`[${name}] fired at \${new Date().toISOString()}\`);
`;
}

program.command("rename <old> <new>")
  .description("Rename a job (updates script, meta, and systemd units atomically)")
  .addHelpText("after", `
Examples:
  $ cronctl rename new-1 nightly-backup
  $ cronctl rename old_name new-name

Preserves: description, tags, schedule, enabled/disabled state, and script body.
`)
  .action(async (oldName: string, newName: string) => {
    const meta = readMeta(oldName);
    if (!meta) { console.error(`No job "${oldName}"`); process.exit(1); }
    if (oldName === newName) { console.error(`Already named "${oldName}"`); process.exit(1); }
    if (!/^[a-zA-Z0-9_-]+$/.test(newName)) { console.error(`Invalid name: ${newName}`); process.exit(1); }
    if (readMeta(newName)) { console.error(`Job "${newName}" already exists`); process.exit(1); }

    const wasEnabled = await isEnabled(oldName);
    await removeUnits(oldName);

    const ext = extname(meta.scriptPath) || ".ts";
    const newScriptPath = join(dirname(meta.scriptPath), `${newName}${ext}`);
    renameSync(meta.scriptPath, newScriptPath);

    deleteMeta(oldName);
    const newMeta: JobMeta = { ...meta, name: newName, scriptPath: newScriptPath };
    saveMeta(newMeta);

    const spec = {
      raw: meta.schedule.raw,
      onCalendar: meta.schedule.onCalendar,
      onUnitActiveSec: meta.schedule.onUnitActiveSec,
      onBootSec: meta.schedule.onBootSec,
      description: meta.schedule.raw,
    };
    writeUnits(newMeta, spec);
    if (wasEnabled) await enableTimer(newName, true);
    else await daemonReload();

    console.log(`✓ renamed "${oldName}" → "${newName}"`);
  });

program.command("remove <name>")
  .alias("rm")
  .description("Unregister and delete a job")
  .option("--keep-script", "keep the script file in ~/.config/cronctl/scripts/")
  .addHelpText("after", `
Examples:
  $ cronctl remove old-backup
  $ cronctl rm old-backup                      # alias
  $ cronctl remove old-backup --keep-script    # keep the .ts file
`)
  .action(async (name, opts) => {
    const meta = readMeta(name);
    if (!meta) { console.error(`No job "${name}"`); process.exit(1); }
    await removeUnits(name);
    if (!opts.keepScript) deleteScript(meta.scriptPath);
    deleteMeta(name);
    console.log(`✓ removed "${name}"`);
  });

program.command("schedule <name> <spec...>")
  .description("Change a job's schedule — e.g. 'cronctl schedule foo daily at 3am'")
  .addHelpText("after", `
Examples:
  $ cronctl schedule backup daily at 3am
  $ cronctl schedule ping every 10 minutes
  $ cronctl schedule report weekdays at 9am
  $ cronctl schedule sweep "mon,wed,fri at 14:30"
  $ cronctl schedule cron-style "0 */2 * * *"
`)
  .action(async (name, specParts: string[]) => {
    const meta = readMeta(name);
    if (!meta) { console.error(`No job "${name}"`); process.exit(1); }
    const spec = parseSchedule(specParts.join(" "));
    meta.schedule = { raw: spec.raw, onCalendar: spec.onCalendar, onUnitActiveSec: spec.onUnitActiveSec, onBootSec: spec.onBootSec };
    saveMeta(meta);
    writeUnits(meta, spec);
    await daemonReload();
    if (await isEnabled(name)) await enableTimer(name, true);
    console.log(`✓ "${name}" rescheduled: ${spec.description}`);
  });

program.command("list")
  .alias("ls")
  .description("List all registered jobs with schedule, next run, tags, and description")
  .addHelpText("after", "\nFor a live-updating view use `cronctl tui`.\n")
  .action(async () => {
    const jobs = listJobs();
    const timers = await listTimers();
    const byName = new Map(timers.map(t => [t.name, t]));
    if (!jobs.length) { console.log("(no jobs — try `cronctl add <script> -s 'daily at 3am'`)"); return; }
    for (const j of jobs) {
      const t = byName.get(j.name);
      const enabled = await isEnabled(j.name);
      const mark = enabled ? "●" : "○";
      const next = t?.next ? t.next.toLocaleString() : "—";
      const tagStr = j.tags.length ? `  [${j.tags.join(" ")}]` : "";
      console.log(`${mark} ${j.name.padEnd(20)} ${j.schedule.raw.padEnd(24)} next: ${next}${tagStr}`);
      if (j.description) console.log(`    ${j.description}`);
    }
  });

program.command("run <name>")
  .description("Run a job now (does not affect the schedule)")
  .addHelpText("after", "\nExamples:\n  $ cronctl run backup\n  $ cronctl run backup && cronctl logs backup\n")
  .action(async (name) => {
    if (!readMeta(name)) { console.error(`No job "${name}"`); process.exit(1); }
    await startService(name);
    console.log(`▶ started "${name}" — tail logs with \`cronctl logs ${name}\``);
  });

program.command("edit <name>")
  .description("Open the job's script in $EDITOR (defaults to `code`)")
  .addHelpText("after", `
The file opened is the managed copy at ~/.config/cronctl/scripts/<name>.ts —
that is the one that actually runs. Save and the next scheduled run uses the
new content. Set EDITOR=nvim (or vim, hx, etc.) to override.
`)
  .action(async (name) => {
    const meta = readMeta(name);
    if (!meta) { console.error(`No job "${name}"`); process.exit(1); }
    const editor = process.env.EDITOR || "code";
    await $`${editor} ${meta.scriptPath}`.nothrow();
  });

program.command("enable <name>")
  .description("Enable & start the timer")
  .addHelpText("after", "\nExample:\n  $ cronctl enable backup\n")
  .action(async (name) => {
  if (!readMeta(name)) { console.error(`No job "${name}"`); process.exit(1); }
  await enableTimer(name, true);
  console.log(`● enabled "${name}"`);
});

program.command("disable <name>")
  .description("Disable & stop the timer")
  .addHelpText("after", "\nExample:\n  $ cronctl disable backup\n")
  .action(async (name) => {
  if (!readMeta(name)) { console.error(`No job "${name}"`); process.exit(1); }
  await disableTimer(name);
  console.log(`○ disabled "${name}"`);
});

program.command("toggle <name>")
  .description("Toggle a job between enabled and disabled")
  .addHelpText("after", "\nExample:\n  $ cronctl toggle backup\n")
  .action(async (name) => {
  if (!readMeta(name)) { console.error(`No job "${name}"`); process.exit(1); }
  if (await isEnabled(name)) { await disableTimer(name); console.log(`○ disabled "${name}"`); }
  else { await enableTimer(name, true); console.log(`● enabled "${name}"`); }
});

program.command("logs <name>")
  .description("Show recent logs for a job (via journalctl)")
  .option("-f, --follow", "follow logs (like tail -f)")
  .option("-n, --lines <n>", "number of lines to show", "50")
  .addHelpText("after", `
Examples:
  $ cronctl logs backup              # last 50 lines
  $ cronctl logs backup -n 200       # last 200 lines
  $ cronctl logs backup -f           # follow (Ctrl-C to stop)

Logs come from systemd's journal. You can also run:
  $ journalctl --user -u cronctl-<name>.service
`)
  .action(async (name, opts) => {
    const { service } = unitNames(name);
    if (opts.follow) await $`journalctl --user -u ${service} -f -n ${opts.lines}`;
    else await $`journalctl --user -u ${service} -n ${opts.lines} --no-pager`;
  });

program.command("describe <name> <description...>")
  .description("Update a job's description (shown in list and TUI)")
  .addHelpText("after", `
Examples:
  $ cronctl describe backup nightly postgres dump to NAS
  $ cronctl describe ping "quick health check"
`)
  .action(async (name, parts: string[]) => {
    const meta = readMeta(name);
    if (!meta) { console.error(`No job "${name}"`); process.exit(1); }
    meta.description = parts.join(" ");
    saveMeta(meta);
    console.log(`✓ "${name}" description updated`);
  });

program.command("tag <name> <tags...>")
  .description("Set a job's tags (replaces existing)")
  .addHelpText("after", `
Examples:
  $ cronctl tag backup nightly critical
  $ cronctl tag backup "a,b,c"       # commas also work
  $ cronctl tag backup               # (nothing after name) clears tags
`)
  .action(async (name, tags: string[]) => {
    const meta = readMeta(name);
    if (!meta) { console.error(`No job "${name}"`); process.exit(1); }
    meta.tags = tags.flatMap(t => t.split(",")).map(t => t.trim()).filter(Boolean);
    saveMeta(meta);
    console.log(`✓ "${name}" tags: ${meta.tags.join(", ") || "(none)"}`);
  });

program.command("tui")
  .description("Open interactive dashboard (live-updating table of all jobs)")
  .addHelpText("after", `
Keybindings (in the TUI):
  ↑↓ / j k     navigate                space / t   toggle enable/disable
  g / G        first / last             e           edit script in $EDITOR
  r            run now                  s           change schedule inline
  x            delete (confirm y/n)     / <text>    filter
  1 .. 5       sort by name/next/last/schedule/enabled
  R            force refresh            q / Ctrl-C  quit
`)
  .action(async () => {
    await import("./tui");
  });

await program.parseAsync();
