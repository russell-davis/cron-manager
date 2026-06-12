export interface ScheduleSpec {
  raw: string;
  onCalendar?: string;
  onUnitActiveSec?: string;
  onBootSec?: string;
  description: string;
}

const DOW: Record<string, string> = {
  mon: "Mon", monday: "Mon",
  tue: "Tue", tues: "Tue", tuesday: "Tue",
  wed: "Wed", weds: "Wed", wednesday: "Wed",
  thu: "Thu", thur: "Thu", thurs: "Thu", thursday: "Thu",
  fri: "Fri", friday: "Fri",
  sat: "Sat", saturday: "Sat",
  sun: "Sun", sunday: "Sun",
};

const SHORTCUTS: Record<string, string> = {
  "@hourly": "hourly", hourly: "hourly",
  "@daily": "daily", daily: "daily",
  "@midnight": "daily", midnight: "daily",
  "@weekly": "weekly", weekly: "weekly",
  "@monthly": "monthly", monthly: "monthly",
  "@yearly": "yearly", yearly: "yearly",
  "@annually": "yearly", annually: "yearly",
};

function parseTime(s: string): { hh: string; mm: string; display: string } | null {
  s = s.trim().toLowerCase();
  if (s === "noon") return { hh: "12", mm: "00", display: "noon" };
  if (s === "midnight") return { hh: "00", mm: "00", display: "midnight" };
  let m = s.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (m) {
    const hh = parseInt(m[1]!, 10);
    const mm = parseInt(m[2]!, 10);
    if (hh < 24 && mm < 60) {
      return { hh: String(hh).padStart(2, "0"), mm: String(mm).padStart(2, "0"), display: `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}` };
    }
  }
  m = s.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)$/);
  if (m) {
    let hh = parseInt(m[1]!, 10);
    const mm = parseInt(m[2] ?? "0", 10);
    const period = m[3]!;
    if (hh === 12) hh = 0;
    if (period === "pm") hh += 12;
    if (hh < 24 && mm < 60) {
      return { hh: String(hh).padStart(2, "0"), mm: String(mm).padStart(2, "0"), display: s };
    }
  }
  return null;
}

function unitToSuffix(unit: string): { suffix: string; name: (n: number) => string } {
  if (unit.startsWith("sec")) return { suffix: "s", name: n => n === 1 ? "second" : "seconds" };
  if (unit.startsWith("min")) return { suffix: "min", name: n => n === 1 ? "minute" : "minutes" };
  if (unit.startsWith("hr") || unit.startsWith("hour")) return { suffix: "h", name: n => n === 1 ? "hour" : "hours" };
  return { suffix: "d", name: n => n === 1 ? "day" : "days" };
}

function cronFieldToOnCal(f: string): string {
  if (f === "*") return "*";
  const step = f.match(/^\*\/(\d+)$/);
  if (step) return `0/${step[1]}`;
  const rangeStep = f.match(/^(\d+)-(\d+)\/(\d+)$/);
  if (rangeStep) return `${rangeStep[1]}-${rangeStep[2]}/${rangeStep[3]}`;
  return f;
}

function cronToOnCalendar(parts: string[]): string | null {
  if (parts.length !== 5) return null;
  const [mi, hr, dom, mo, dow] = parts as [string, string, string, string, string];
  const dowNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  let dowPart = "";
  if (dow !== "*" && dow !== "?") {
    const parts = dow.split(",").map(d => {
      const n = parseInt(d, 10);
      if (!isNaN(n) && n >= 0 && n <= 7) return dowNames[n % 7];
      return null;
    }).filter(Boolean) as string[];
    if (!parts.length) return null;
    dowPart = `${parts.join(",")} `;
  }
  const miOut = cronFieldToOnCal(mi);
  const hrOut = cronFieldToOnCal(hr);
  const domOut = cronFieldToOnCal(dom);
  const moOut = cronFieldToOnCal(mo);
  return `${dowPart}*-${moOut}-${domOut} ${hrOut}:${miOut}:00`;
}

const HELP_HINT = [
  "Try:",
  "  every 5 minutes",
  "  every 2 hours",
  "  daily at 3am",
  "  weekdays at 9am",
  "  mon,wed,fri at 14:30",
  "  @hourly  @daily  @weekly",
  "  0 3 * * *                 (cron)",
  "  Mon..Fri *-*-* 09:00:00   (systemd OnCalendar)",
].join("\n");

export function parseSchedule(input: string): ScheduleSpec {
  const raw = input.trim();
  const s = raw.toLowerCase();

  if (s in SHORTCUTS) {
    const cal = SHORTCUTS[s]!;
    return { raw, onCalendar: cal, description: cal };
  }

  let m = s.match(/^every\s+(\d+)\s*(min(?:ute)?s?|hours?|hrs?|days?|secs?|seconds?)$/);
  if (m) {
    const n = parseInt(m[1]!, 10);
    const { suffix, name } = unitToSuffix(m[2]!);
    return {
      raw,
      onUnitActiveSec: `${n}${suffix}`,
      onBootSec: "30s",
      description: `every ${n} ${name(n)}`,
    };
  }

  m = s.match(/^every\s+(min(?:ute)?|hour|hr|day|second|sec)$/);
  if (m) return parseSchedule(`every 1 ${m[1]}`);

  m = s.match(/^daily\s+at\s+(.+)$/);
  if (m) {
    const t = parseTime(m[1]!);
    if (t) return { raw, onCalendar: `*-*-* ${t.hh}:${t.mm}:00`, description: `daily at ${t.display}` };
  }

  m = s.match(/^weekdays?\s+at\s+(.+)$/);
  if (m) {
    const t = parseTime(m[1]!);
    if (t) return { raw, onCalendar: `Mon..Fri *-*-* ${t.hh}:${t.mm}:00`, description: `weekdays at ${t.display}` };
  }

  m = s.match(/^weekends?\s+at\s+(.+)$/);
  if (m) {
    const t = parseTime(m[1]!);
    if (t) return { raw, onCalendar: `Sat,Sun *-*-* ${t.hh}:${t.mm}:00`, description: `weekends at ${t.display}` };
  }

  // day-of-week(s) at TIME
  m = s.match(/^([a-z][a-z,\s]*?)\s+at\s+(.+)$/);
  if (m) {
    const daysRaw = m[1]!.split(/[,\s]+/).filter(Boolean);
    const days = daysRaw.map(d => DOW[d]).filter(Boolean);
    if (days.length && days.length === daysRaw.length) {
      const t = parseTime(m[2]!);
      if (t) return { raw, onCalendar: `${days.join(",")} *-*-* ${t.hh}:${t.mm}:00`, description: `${days.join(",")} at ${t.display}` };
    }
  }

  // bare cron expression
  const parts = raw.split(/\s+/);
  if (parts.length === 5 && parts.every(p => /^[\d*/,\-]+$/.test(p))) {
    const oc = cronToOnCalendar(parts);
    if (oc) return { raw, onCalendar: oc, description: `cron: ${raw}` };
  }

  // systemd OnCalendar pass-through — only if input looks structurally like one:
  //   `*-*-* HH:MM:SS`  or  `Mon..Fri *-*-* HH:MM:SS`  or  `Mon,Wed *-*-* ...`
  const looksLikeOnCalendar =
    /\*-\*?-?\*?\s+\d/.test(raw) ||                    // *-*-* 03:00...
    /^[A-Z][a-z]{2}(?:\.\.[A-Z][a-z]{2}|,[A-Z][a-z]{2})*\s+[-*\d]/.test(raw); // Mon..Fri / Mon,Wed prefix
  if (looksLikeOnCalendar) {
    return { raw, onCalendar: raw, description: raw };
  }

  throw new Error(`Could not parse schedule: "${input}"\n\n${HELP_HINT}`);
}
