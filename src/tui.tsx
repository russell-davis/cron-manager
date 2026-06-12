import { createCliRenderer } from "@opentui/core";
import { createRoot, useKeyboard, useRenderer } from "@opentui/react";
import React, { useEffect, useMemo, useState } from "react";
import { $ } from "bun";
import { listJobs, readMeta, saveMeta, deleteMeta, deleteScript } from "./store";
import {
  listTimers, isEnabled, enableTimer, disableTimer,
  startService, removeUnits, writeUnits, daemonReload,
} from "./systemd";
import { parseSchedule } from "./schedule";
import type { JobMeta } from "./types";

interface JobRow {
  meta: JobMeta;
  enabled: boolean;
  next?: Date;
  last?: Date;
}

type SortKey = "name" | "next" | "last" | "schedule" | "enabled";
type Mode = "list" | "confirm-delete" | "edit-schedule" | "filter";

function formatRel(d?: Date): string {
  if (!d) return "—";
  const ms = d.getTime() - Date.now();
  const past = ms < 0;
  const abs = Math.abs(ms);
  const s = Math.floor(abs / 1000);
  if (s < 60) return past ? `${s}s ago` : `in ${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return past ? `${m}m ago` : `in ${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return past ? `${h}h ago` : `in ${h}h`;
  const dd = Math.floor(h / 24);
  return past ? `${dd}d ago` : `in ${dd}d`;
}

function pad(s: string, n: number): string {
  if (s.length >= n) return s.slice(0, n);
  return s + " ".repeat(n - s.length);
}

function App() {
  const [rows, setRows] = useState<JobRow[]>([]);
  const [selected, setSelected] = useState(0);
  const [sortKey, setSortKey] = useState<SortKey>("next");
  const [filter, setFilter] = useState("");
  const [mode, setMode] = useState<Mode>("list");
  const [input, setInput] = useState("");
  const [message, setMessage] = useState("");
  const [tick, setTick] = useState(0);
  const renderer = useRenderer();

  const quit = () => {
    try { renderer.destroy(); } catch {}
    // belt-and-suspenders: show cursor, exit alt screen, disable mouse tracking,
    // disable bracketed paste, reset attributes. Safe to emit even if already done.
    try {
      process.stdout.write(
        "\x1b[?25h" +      // show cursor
        "\x1b[?1049l" +    // exit alt screen buffer
        "\x1b[?1000l" +    // disable mouse tracking (click)
        "\x1b[?1002l" +    // disable mouse tracking (drag)
        "\x1b[?1003l" +    // disable mouse tracking (all motion)
        "\x1b[?1006l" +    // disable SGR mouse mode
        "\x1b[?2004l" +    // disable bracketed paste
        "\x1b[0m"          // reset attributes
      );
      if (process.stdin.isTTY) process.stdin.setRawMode(false);
    } catch {}
    process.exit(0);
  };

  useEffect(() => {
    const onSig = () => quit();
    process.on("SIGINT", onSig);
    process.on("SIGTERM", onSig);
    return () => {
      process.off("SIGINT", onSig);
      process.off("SIGTERM", onSig);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const jobs = listJobs();
      const timers = await listTimers();
      const byName = new Map(timers.map(t => [t.name, t]));
      const out: JobRow[] = [];
      for (const j of jobs) {
        const t = byName.get(j.name);
        const enabled = await isEnabled(j.name);
        out.push({ meta: j, enabled, next: t?.next, last: t?.last });
      }
      if (!cancelled) setRows(out);
    }
    load();
    const iv = setInterval(load, 2000);
    return () => { cancelled = true; clearInterval(iv); };
  }, [tick]);

  const filtered = useMemo(() => {
    const f = filter.toLowerCase();
    let r = rows;
    if (f) {
      r = r.filter(row =>
        row.meta.name.toLowerCase().includes(f) ||
        row.meta.description.toLowerCase().includes(f) ||
        row.meta.tags.some(t => t.toLowerCase().includes(f)) ||
        row.meta.schedule.raw.toLowerCase().includes(f)
      );
    }
    return [...r].sort((a, b) => {
      switch (sortKey) {
        case "name": return a.meta.name.localeCompare(b.meta.name);
        case "next": return (a.next?.getTime() ?? Infinity) - (b.next?.getTime() ?? Infinity);
        case "last": return (b.last?.getTime() ?? 0) - (a.last?.getTime() ?? 0);
        case "schedule": return a.meta.schedule.raw.localeCompare(b.meta.schedule.raw);
        case "enabled": return Number(b.enabled) - Number(a.enabled);
      }
    });
  }, [rows, sortKey, filter]);

  const current = filtered[Math.min(selected, Math.max(0, filtered.length - 1))];

  useKeyboard(async (k: any) => {
    if (mode === "edit-schedule" || mode === "filter") {
      if (k.name === "return") {
        if (mode === "edit-schedule" && current) {
          try {
            const spec = parseSchedule(input);
            const meta = current.meta;
            meta.schedule = { raw: spec.raw, onCalendar: spec.onCalendar, onUnitActiveSec: spec.onUnitActiveSec, onBootSec: spec.onBootSec };
            saveMeta(meta);
            writeUnits(meta, spec);
            await daemonReload();
            if (current.enabled) await enableTimer(meta.name, true);
            setMessage(`✓ ${meta.name}: ${spec.description}`);
          } catch (e: any) {
            setMessage(`✗ ${String(e.message || e).split("\n")[0]}`);
          }
        } else if (mode === "filter") {
          setFilter(input);
        }
        setInput("");
        setMode("list");
        setTick(t => t + 1);
      } else if (k.name === "escape") {
        setInput("");
        setMode("list");
      } else if (k.name === "backspace") {
        setInput(s => s.slice(0, -1));
      } else if (k.sequence && k.sequence.length === 1 && !k.ctrl && !k.meta) {
        setInput(s => s + k.sequence);
      }
      return;
    }
    if (mode === "confirm-delete") {
      if (k.name === "y" && current) {
        const meta = current.meta;
        await removeUnits(meta.name);
        deleteScript(meta.scriptPath);
        deleteMeta(meta.name);
        setMessage(`✓ removed ${meta.name}`);
        setMode("list");
        setTick(t => t + 1);
      } else if (k.name === "n" || k.name === "escape") {
        setMode("list");
      }
      return;
    }
    // list mode
    if (k.name === "q" || (k.ctrl && k.name === "c")) return quit();
    if (k.name === "up" || k.name === "k") setSelected(s => Math.max(0, s - 1));
    if (k.name === "down" || k.name === "j") setSelected(s => Math.min(filtered.length - 1, s + 1));
    if (k.name === "g") setSelected(0);
    if (k.name === "G" || k.shift && k.name === "g") setSelected(Math.max(0, filtered.length - 1));
    if (!current) return;
    if (k.name === "e") {
      const editor = process.env.EDITOR || "code";
      await $`${editor} ${current.meta.scriptPath}`.nothrow();
      setMessage(`opened ${current.meta.name} in ${editor}`);
    }
    if (k.name === "r") {
      await startService(current.meta.name);
      setMessage(`▶ ran ${current.meta.name}`);
      setTick(t => t + 1);
    }
    if (k.name === "space" || k.name === "t") {
      if (current.enabled) { await disableTimer(current.meta.name); setMessage(`○ disabled ${current.meta.name}`); }
      else { await enableTimer(current.meta.name, true); setMessage(`● enabled ${current.meta.name}`); }
      setTick(t => t + 1);
    }
    if (k.name === "s") {
      setInput(current.meta.schedule.raw);
      setMode("edit-schedule");
    }
    if (k.name === "x" || k.name === "delete") setMode("confirm-delete");
    if (k.name === "/") { setInput(filter); setMode("filter"); }
    if (k.name === "1") setSortKey("name");
    if (k.name === "2") setSortKey("next");
    if (k.name === "3") setSortKey("last");
    if (k.name === "4") setSortKey("schedule");
    if (k.name === "5") setSortKey("enabled");
    if (k.name === "R") setTick(t => t + 1);
  });

  return (
    <box style={{ flexDirection: "column", padding: 1 }}>
      <box style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <text fg="#50fa7b"> cronctl </text>
        <text fg="#6272a4">
          {filtered.length}/{rows.length} jobs · sort:{sortKey}{filter ? ` · filter:${filter}` : ""}
        </text>
      </box>
      <text fg="#44475a">───────────────────────────────────────────────────────────────────────────────</text>
      <box style={{ flexDirection: "column" }}>
        {filtered.length === 0 && (
          <text fg="#6272a4">  (no jobs — run `cronctl add &lt;script&gt; -s 'daily at 3am'`)</text>
        )}
        {filtered.map((row, i) => {
          const sel = i === selected;
          const mark = row.enabled ? "●" : "○";
          const markColor = row.enabled ? "#50fa7b" : "#6272a4";
          const tagStr = row.meta.tags.length ? `  [${row.meta.tags.join(" ")}]` : "";
          return (
            <box key={row.meta.name} style={{ flexDirection: "column" }}>
              <box style={{ flexDirection: "row" }}>
                <text fg={sel ? "#f8f8f2" : "#bd93f9"} bg={sel ? "#44475a" : undefined}>
                  {sel ? "▸" : " "} {mark} {pad(row.meta.name, 22)} {pad(row.meta.schedule.raw, 26)} next {pad(formatRel(row.next), 11)} last {formatRel(row.last)}{tagStr}
                </text>
              </box>
              <text fg="#6272a4">    {row.meta.description || (sel ? "(no description)" : "")}</text>
            </box>
          );
        })}
      </box>
      <text fg="#44475a">───────────────────────────────────────────────────────────────────────────────</text>
      {mode === "list" && (
        <text fg="#6272a4">
          ↑↓ nav · space toggle · e edit · r run now · s change schedule · x delete · / filter · 1-5 sort (name/next/last/sched/on) · R refresh · q quit
        </text>
      )}
      {mode === "edit-schedule" && (
        <text fg="#f1fa8c">  new schedule: {input}█  (enter=save, esc=cancel · e.g. "every 5 minutes", "daily at 3am")</text>
      )}
      {mode === "filter" && (
        <text fg="#f1fa8c">  filter: {input}█  (enter=apply, esc=cancel)</text>
      )}
      {mode === "confirm-delete" && current && (
        <text fg="#ff5555">  delete "{current.meta.name}" and its script? [y/n]</text>
      )}
      {message && <text fg="#8be9fd">  {message}</text>}
    </box>
  );
}

const renderer = await createCliRenderer();
createRoot(renderer).render(<App />);
