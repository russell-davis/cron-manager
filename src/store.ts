import { mkdirSync, readFileSync, writeFileSync, readdirSync, existsSync, unlinkSync, copyFileSync } from "fs";
import { join, extname } from "path";
import { paths } from "./paths";
import type { JobMeta } from "./types";

export function ensureDirs() {
  mkdirSync(paths.scriptsDir, { recursive: true });
  mkdirSync(paths.metaDir, { recursive: true });
}

export function saveMeta(meta: JobMeta) {
  ensureDirs();
  writeFileSync(join(paths.metaDir, `${meta.name}.json`), JSON.stringify(meta, null, 2));
}

export function readMeta(name: string): JobMeta | null {
  const p = join(paths.metaDir, `${name}.json`);
  if (!existsSync(p)) return null;
  return JSON.parse(readFileSync(p, "utf8"));
}

export function listJobs(): JobMeta[] {
  ensureDirs();
  return readdirSync(paths.metaDir)
    .filter(f => f.endsWith(".json"))
    .map(f => JSON.parse(readFileSync(join(paths.metaDir, f), "utf8")) as JobMeta)
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function deleteMeta(name: string) {
  const p = join(paths.metaDir, `${name}.json`);
  if (existsSync(p)) unlinkSync(p);
}

export function importScript(sourcePath: string, name: string): string {
  ensureDirs();
  const ext = extname(sourcePath) || ".ts";
  const dest = join(paths.scriptsDir, `${name}${ext}`);
  copyFileSync(sourcePath, dest);
  return dest;
}

export function deleteScript(scriptPath: string) {
  if (existsSync(scriptPath)) unlinkSync(scriptPath);
}
