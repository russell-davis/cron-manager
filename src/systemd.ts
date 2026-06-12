import { writeFileSync, unlinkSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { $ } from "bun";
import { paths, UNIT_PREFIX, isDryRun } from "./paths";
import type { JobMeta } from "./types";
import type { ScheduleSpec } from "./schedule";

export function unitNames(name: string) {
  return {
    service: `${UNIT_PREFIX}${name}.service`,
    timer: `${UNIT_PREFIX}${name}.timer`,
  };
}

export function writeUnits(meta: JobMeta, spec: ScheduleSpec) {
  mkdirSync(paths.systemdUserDir, { recursive: true });
  const { service, timer } = unitNames(meta.name);
  const bunBin = Bun.which("bun") ?? "/usr/bin/env bun";

  const serviceContent = [
    `# cronctl-managed unit for "${meta.name}"`,
    meta.description ? `# Description: ${meta.description}` : null,
    meta.tags.length ? `# Tags: ${meta.tags.join(", ")}` : null,
    ``,
    `[Unit]`,
    `Description=cronctl: ${meta.name}${meta.description ? " — " + meta.description : ""}`,
    ``,
    `[Service]`,
    `Type=oneshot`,
    `ExecStart=${bunBin} run ${meta.scriptPath}`,
    ``,
  ].filter(l => l !== null).join("\n");

  const timerLines = [
    `# cronctl-managed timer for "${meta.name}"`,
    `# Schedule: ${spec.raw}  →  ${spec.description}`,
    ``,
    `[Unit]`,
    `Description=cronctl timer: ${meta.name} (${spec.description})`,
    ``,
    `[Timer]`,
    `Unit=${service}`,
    `Persistent=true`,
  ];
  if (spec.onCalendar) timerLines.push(`OnCalendar=${spec.onCalendar}`);
  if (spec.onUnitActiveSec) timerLines.push(`OnUnitActiveSec=${spec.onUnitActiveSec}`);
  if (spec.onBootSec) timerLines.push(`OnBootSec=${spec.onBootSec}`);
  timerLines.push(``, `[Install]`, `WantedBy=timers.target`, ``);

  writeFileSync(join(paths.systemdUserDir, service), serviceContent);
  writeFileSync(join(paths.systemdUserDir, timer), timerLines.join("\n"));
}

export async function daemonReload() {
  if (isDryRun()) return;
  await $`systemctl --user daemon-reload`.quiet();
}

export async function enableTimer(name: string, now = true) {
  const { timer } = unitNames(name);
  if (isDryRun()) return;
  await daemonReload();
  if (now) await $`systemctl --user enable --now ${timer}`.quiet();
  else await $`systemctl --user enable ${timer}`.quiet();
}

export async function disableTimer(name: string) {
  const { timer } = unitNames(name);
  if (isDryRun()) return;
  await $`systemctl --user disable --now ${timer}`.quiet().nothrow();
}

export async function startService(name: string) {
  const { service } = unitNames(name);
  if (isDryRun()) return;
  await $`systemctl --user start ${service}`.quiet();
}

export async function removeUnits(name: string) {
  const { service, timer } = unitNames(name);
  await disableTimer(name);
  const servicePath = join(paths.systemdUserDir, service);
  const timerPath = join(paths.systemdUserDir, timer);
  if (existsSync(servicePath)) unlinkSync(servicePath);
  if (existsSync(timerPath)) unlinkSync(timerPath);
  await daemonReload();
}

export interface TimerRow {
  unit: string;
  name: string;
  next?: Date;
  last?: Date;
  activates: string;
}

export async function listTimers(): Promise<TimerRow[]> {
  if (isDryRun()) return [];
  const r = await $`systemctl --user list-timers --all --output=json`.quiet().nothrow();
  const text = r.stdout.toString().trim();
  if (!text) return [];
  const data = JSON.parse(text);
  return (data as any[])
    .filter(t => typeof t.unit === "string" && t.unit.startsWith(UNIT_PREFIX))
    .map(t => ({
      unit: t.unit,
      name: t.unit.replace(UNIT_PREFIX, "").replace(/\.timer$/, ""),
      next: t.next && t.next > 0 ? new Date(Math.floor(t.next / 1000)) : undefined,
      last: t.last && t.last > 0 ? new Date(Math.floor(t.last / 1000)) : undefined,
      activates: t.activates,
    }));
}

export async function isEnabled(name: string): Promise<boolean> {
  const { timer } = unitNames(name);
  if (isDryRun()) return false;
  const r = await $`systemctl --user is-enabled ${timer}`.quiet().nothrow();
  return r.exitCode === 0;
}

export async function isActive(name: string): Promise<boolean> {
  const { timer } = unitNames(name);
  if (isDryRun()) return false;
  const r = await $`systemctl --user is-active ${timer}`.quiet().nothrow();
  return r.exitCode === 0;
}
