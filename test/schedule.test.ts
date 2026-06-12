import { describe, test, expect } from "bun:test";
import { parseSchedule } from "../src/schedule";

describe("shortcuts", () => {
  const cases: Array<[string, string]> = [
    ["@hourly", "hourly"],
    ["hourly", "hourly"],
    ["@daily", "daily"],
    ["daily", "daily"],
    ["@midnight", "daily"],
    ["midnight", "daily"],
    ["@weekly", "weekly"],
    ["weekly", "weekly"],
    ["@monthly", "monthly"],
    ["monthly", "monthly"],
    ["@yearly", "yearly"],
    ["@annually", "yearly"],
    ["annually", "yearly"],
  ];
  for (const [input, expected] of cases) {
    test(`"${input}" → OnCalendar=${expected}`, () => {
      const spec = parseSchedule(input);
      expect(spec.onCalendar).toBe(expected);
      expect(spec.onUnitActiveSec).toBeUndefined();
      expect(spec.description).toBe(expected);
      expect(spec.raw).toBe(input);
    });
  }

  test("case-insensitive", () => {
    expect(parseSchedule("DAILY").onCalendar).toBe("daily");
    expect(parseSchedule("@HOURLY").onCalendar).toBe("hourly");
  });

  test("whitespace tolerated", () => {
    expect(parseSchedule("  daily  ").onCalendar).toBe("daily");
  });
});

describe("every N <unit> (interval timers)", () => {
  const cases: Array<[string, string, string]> = [
    ["every 30 seconds", "30s", "every 30 seconds"],
    ["every 1 second", "1s", "every 1 second"],
    ["every 5 minutes", "5min", "every 5 minutes"],
    ["every 1 minute", "1min", "every 1 minute"],
    ["every 15 min", "15min", "every 15 minutes"],
    ["every 2 hours", "2h", "every 2 hours"],
    ["every 1 hour", "1h", "every 1 hour"],
    ["every 6 hrs", "6h", "every 6 hours"],
    ["every 1 day", "1d", "every 1 day"],
    ["every 7 days", "7d", "every 7 days"],
  ];
  for (const [input, active, desc] of cases) {
    test(`"${input}" → OnUnitActiveSec=${active}`, () => {
      const spec = parseSchedule(input);
      expect(spec.onUnitActiveSec).toBe(active);
      expect(spec.onBootSec).toBe("30s");
      expect(spec.description).toBe(desc);
      expect(spec.onCalendar).toBeUndefined();
    });
  }

  test("bare 'every <unit>' is same as 'every 1 <unit>'", () => {
    expect(parseSchedule("every minute").onUnitActiveSec).toBe("1min");
    expect(parseSchedule("every hour").onUnitActiveSec).toBe("1h");
    expect(parseSchedule("every day").onUnitActiveSec).toBe("1d");
    expect(parseSchedule("every second").onUnitActiveSec).toBe("1s");
  });

  test("plural / singular both work", () => {
    expect(parseSchedule("every 1 minutes").onUnitActiveSec).toBe("1min");
    expect(parseSchedule("every 2 minute").onUnitActiveSec).toBe("2min");
  });
});

describe("daily at TIME", () => {
  test("12-hour with am/pm", () => {
    expect(parseSchedule("daily at 3am").onCalendar).toBe("*-*-* 03:00:00");
    expect(parseSchedule("daily at 3pm").onCalendar).toBe("*-*-* 15:00:00");
    expect(parseSchedule("daily at 12am").onCalendar).toBe("*-*-* 00:00:00");
    expect(parseSchedule("daily at 12pm").onCalendar).toBe("*-*-* 12:00:00");
    expect(parseSchedule("daily at 11pm").onCalendar).toBe("*-*-* 23:00:00");
  });

  test("12-hour with minutes", () => {
    expect(parseSchedule("daily at 3:30pm").onCalendar).toBe("*-*-* 15:30:00");
    expect(parseSchedule("daily at 11:45am").onCalendar).toBe("*-*-* 11:45:00");
  });

  test("24-hour HH:MM", () => {
    expect(parseSchedule("daily at 14:30").onCalendar).toBe("*-*-* 14:30:00");
    expect(parseSchedule("daily at 00:00").onCalendar).toBe("*-*-* 00:00:00");
    expect(parseSchedule("daily at 23:59").onCalendar).toBe("*-*-* 23:59:00");
    expect(parseSchedule("daily at 9:05").onCalendar).toBe("*-*-* 09:05:00");
  });

  test("HH:MM:SS tolerated (seconds dropped)", () => {
    expect(parseSchedule("daily at 14:30:00").onCalendar).toBe("*-*-* 14:30:00");
  });

  test("keywords noon and midnight", () => {
    expect(parseSchedule("daily at noon").onCalendar).toBe("*-*-* 12:00:00");
    expect(parseSchedule("daily at midnight").onCalendar).toBe("*-*-* 00:00:00");
  });
});

describe("weekdays / weekends at TIME", () => {
  test("weekdays", () => {
    expect(parseSchedule("weekdays at 9am").onCalendar).toBe("Mon..Fri *-*-* 09:00:00");
    expect(parseSchedule("weekday at 9am").onCalendar).toBe("Mon..Fri *-*-* 09:00:00");
  });

  test("weekends", () => {
    expect(parseSchedule("weekends at 10am").onCalendar).toBe("Sat,Sun *-*-* 10:00:00");
    expect(parseSchedule("weekend at 10am").onCalendar).toBe("Sat,Sun *-*-* 10:00:00");
  });
});

describe("day-of-week at TIME", () => {
  test("single day full name", () => {
    expect(parseSchedule("monday at 8am").onCalendar).toBe("Mon *-*-* 08:00:00");
    expect(parseSchedule("tuesday at 8am").onCalendar).toBe("Tue *-*-* 08:00:00");
    expect(parseSchedule("wednesday at 8am").onCalendar).toBe("Wed *-*-* 08:00:00");
    expect(parseSchedule("thursday at 8am").onCalendar).toBe("Thu *-*-* 08:00:00");
    expect(parseSchedule("friday at 8am").onCalendar).toBe("Fri *-*-* 08:00:00");
    expect(parseSchedule("saturday at 8am").onCalendar).toBe("Sat *-*-* 08:00:00");
    expect(parseSchedule("sunday at 8am").onCalendar).toBe("Sun *-*-* 08:00:00");
  });

  test("single day 3-letter abbrev", () => {
    expect(parseSchedule("mon at 8am").onCalendar).toBe("Mon *-*-* 08:00:00");
    expect(parseSchedule("fri at 17:00").onCalendar).toBe("Fri *-*-* 17:00:00");
  });

  test("multiple days comma-separated", () => {
    expect(parseSchedule("mon,wed,fri at 14:30").onCalendar).toBe("Mon,Wed,Fri *-*-* 14:30:00");
  });

  test("multiple days space-separated", () => {
    expect(parseSchedule("mon wed fri at 14:30").onCalendar).toBe("Mon,Wed,Fri *-*-* 14:30:00");
  });

  test("description shows resolved days", () => {
    expect(parseSchedule("mon,fri at 9am").description).toContain("Mon,Fri");
  });
});

describe("cron expressions", () => {
  test("simple 5-field cron", () => {
    expect(parseSchedule("0 3 * * *").onCalendar).toContain("*-*-*");
    expect(parseSchedule("0 3 * * *").onCalendar).toContain("3:0:00");
  });

  test("step values", () => {
    expect(parseSchedule("*/5 * * * *").onCalendar).toContain("*:0/5:00");
  });

  test("day-of-week numeric", () => {
    // 1-5 gets parsed but since it's a range not a list, we pass it as-is
    const spec = parseSchedule("0 9 * * 1");
    expect(spec.onCalendar).toContain("Mon");
  });

  test("description marks it as cron", () => {
    expect(parseSchedule("0 3 * * *").description).toBe("cron: 0 3 * * *");
  });
});

describe("raw OnCalendar passthrough", () => {
  test("accepts systemd-style spec verbatim", () => {
    expect(parseSchedule("*-*-* 03:00:00").onCalendar).toBe("*-*-* 03:00:00");
  });

  test("preserves raw input", () => {
    const spec = parseSchedule("*-*-* 03:00:00");
    expect(spec.raw).toBe("*-*-* 03:00:00");
  });
});

describe("error cases", () => {
  test("throws on pure garbage", () => {
    expect(() => parseSchedule("definitely not a schedule")).toThrow(/Could not parse/);
  });

  test("throws on empty string", () => {
    expect(() => parseSchedule("")).toThrow();
  });

  test("error message includes help hint", () => {
    try {
      parseSchedule("nonsense");
    } catch (e: any) {
      expect(e.message).toContain("every 5 minutes");
      expect(e.message).toContain("daily at 3am");
      expect(e.message).toContain("OnCalendar");
    }
  });

  test("rejects invalid day-of-week", () => {
    expect(() => parseSchedule("funday at 9am")).toThrow();
  });

  test("rejects invalid time", () => {
    expect(() => parseSchedule("daily at 25:00")).toThrow();
    expect(() => parseSchedule("daily at 12:99")).toThrow();
  });
});

describe("raw field preserved", () => {
  test("trims whitespace", () => {
    expect(parseSchedule("  every 5 minutes  ").raw).toBe("every 5 minutes");
  });

  test("preserves original casing", () => {
    expect(parseSchedule("Daily At 3AM").raw).toBe("Daily At 3AM");
  });
});
