import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync } from "fs";
import { join } from "path";
import { makeSandbox } from "./helpers";
import {
  ensureDirs, saveMeta, readMeta, listJobs, deleteMeta,
  importScript, deleteScript,
} from "../src/store";
import { paths } from "../src/paths";
import type { JobMeta } from "../src/types";

function sampleMeta(overrides: Partial<JobMeta> = {}): JobMeta {
  return {
    name: "sample",
    description: "a sample job",
    tags: ["test"],
    scriptPath: "/tmp/sample.ts",
    originalPath: "/tmp/src/sample.ts",
    schedule: { raw: "daily at 3am", onCalendar: "*-*-* 03:00:00" },
    createdAt: "2026-04-20T00:00:00.000Z",
    ...overrides,
  };
}

describe("store", () => {
  let sb: ReturnType<typeof makeSandbox>;
  beforeEach(() => { sb = makeSandbox(); });
  afterEach(() => { sb.cleanup(); });

  test("ensureDirs creates scripts + meta dirs", () => {
    ensureDirs();
    expect(existsSync(paths.scriptsDir)).toBe(true);
    expect(existsSync(paths.metaDir)).toBe(true);
  });

  test("ensureDirs is idempotent", () => {
    ensureDirs();
    ensureDirs();
    expect(existsSync(paths.scriptsDir)).toBe(true);
  });

  test("saveMeta writes a readable JSON file", () => {
    const m = sampleMeta();
    saveMeta(m);
    const p = join(paths.metaDir, "sample.json");
    expect(existsSync(p)).toBe(true);
    const parsed = JSON.parse(readFileSync(p, "utf8"));
    expect(parsed).toEqual(m);
  });

  test("readMeta returns null for missing job", () => {
    expect(readMeta("nope")).toBeNull();
  });

  test("saveMeta → readMeta roundtrip", () => {
    const m = sampleMeta({ name: "backup", tags: ["nightly", "critical"] });
    saveMeta(m);
    const back = readMeta("backup");
    expect(back).toEqual(m);
  });

  test("saveMeta overwrites existing meta", () => {
    saveMeta(sampleMeta({ description: "v1" }));
    saveMeta(sampleMeta({ description: "v2" }));
    expect(readMeta("sample")?.description).toBe("v2");
  });

  test("listJobs returns [] for empty store", () => {
    expect(listJobs()).toEqual([]);
  });

  test("listJobs returns all saved jobs, sorted by name", () => {
    saveMeta(sampleMeta({ name: "charlie" }));
    saveMeta(sampleMeta({ name: "alpha" }));
    saveMeta(sampleMeta({ name: "bravo" }));
    const jobs = listJobs();
    expect(jobs.map(j => j.name)).toEqual(["alpha", "bravo", "charlie"]);
  });

  test("listJobs ignores non-JSON files in meta dir", () => {
    ensureDirs();
    saveMeta(sampleMeta({ name: "real" }));
    writeFileSync(join(paths.metaDir, "not-meta.txt"), "junk");
    writeFileSync(join(paths.metaDir, "README.md"), "# notes");
    const jobs = listJobs();
    expect(jobs.map(j => j.name)).toEqual(["real"]);
  });

  test("deleteMeta removes the file", () => {
    saveMeta(sampleMeta());
    expect(readMeta("sample")).not.toBeNull();
    deleteMeta("sample");
    expect(readMeta("sample")).toBeNull();
  });

  test("deleteMeta is a no-op for missing job", () => {
    expect(() => deleteMeta("ghost")).not.toThrow();
  });

  test("importScript copies into scripts dir with correct name + ext", () => {
    const src = join(sb.root, "orig.ts");
    writeFileSync(src, "console.log('hi');");
    const dest = importScript(src, "myjob");
    expect(dest).toBe(join(paths.scriptsDir, "myjob.ts"));
    expect(existsSync(dest)).toBe(true);
    expect(readFileSync(dest, "utf8")).toBe("console.log('hi');");
  });

  test("importScript defaults to .ts when source has no ext", () => {
    const src = join(sb.root, "no-ext");
    writeFileSync(src, "echo hi");
    const dest = importScript(src, "myjob");
    expect(dest).toBe(join(paths.scriptsDir, "myjob.ts"));
  });

  test("importScript preserves non-ts extensions", () => {
    const src = join(sb.root, "orig.sh");
    writeFileSync(src, "#!/bin/bash\necho hi");
    const dest = importScript(src, "shell-job");
    expect(dest).toBe(join(paths.scriptsDir, "shell-job.sh"));
  });

  test("importScript overwrites existing destination", () => {
    const src1 = join(sb.root, "v1.ts");
    writeFileSync(src1, "v1");
    importScript(src1, "job");
    const src2 = join(sb.root, "v2.ts");
    writeFileSync(src2, "v2");
    importScript(src2, "job");
    expect(readFileSync(join(paths.scriptsDir, "job.ts"), "utf8")).toBe("v2");
  });

  test("deleteScript removes the file", () => {
    const src = join(sb.root, "orig.ts");
    writeFileSync(src, "x");
    const dest = importScript(src, "job");
    deleteScript(dest);
    expect(existsSync(dest)).toBe(false);
  });

  test("deleteScript tolerates missing file", () => {
    expect(() => deleteScript("/tmp/does-not-exist.ts")).not.toThrow();
  });
});
