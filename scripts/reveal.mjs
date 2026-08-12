// Teacher local settlement ("教师本地结算").
//
// The platform NEVER sees real identities: the server only knows hash + XP.
// At the end of term the teacher joins two files ON THEIR OWN MACHINE:
//   1. The hash-only export (from the server, e.g. GET /api/teacher/export)
//   2. A local roster CSV the teacher collected in person: student_id,hash
//
// Usage:
//   node scripts/reveal.mjs --export data/export.csv --roster roster.csv
//   node scripts/reveal.mjs --server http://localhost:3000 --roster roster.csv
//
// roster.csv format (comma-separated, header required):
//   student_id,hash
//   20012345,a1b2c3d4...
//
// Output: a terminal table of student_id -> xp/level, plus a grades.csv.

import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));

function parseArgs() {
  const argv = process.argv.slice(2);
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (argv[i].startsWith("--")) out[argv[i].slice(2)] = argv[i + 1];
  }
  return out;
}

function parseCsv(text) {
  return text
    .trim()
    .split("\n")
    .map((line) => line.split(",").map((c) => c.trim()))
    .filter((r) => r.length > 1 && r[0] !== "student_id" && r[0] !== "hash");
}

async function loadExport(args) {
  if (args.server) {
    const res = await fetch(`${args.server.replace(/\/$/, "")}/api/teacher/export`);
    if (!res.ok) throw new Error(`Server export failed: ${res.status}`);
    return await res.text();
  }
  const file = args.export || join(__dirname, "..", "data", "export.csv");
  if (!existsSync(file)) throw new Error(`Export file not found: ${file} (fetch it from GET /api/teacher/export first)`);
  return readFile(file, "utf8");
}

async function main() {
  const args = parseArgs();
  if (!args.roster) {
    console.error("Usage: node scripts/reveal.mjs --roster roster.csv [--export export.csv | --server http://localhost:3000]");
    process.exit(1);
  }
  if (!existsSync(args.roster)) {
    console.error(`Roster not found: ${args.roster}`);
    process.exit(1);
  }

  const roster = parseCsv(await readFile(args.roster, "utf8"));
  const exportRows = parseCsv(await loadExport(args));
  const byHash = new Map(exportRows.map((r) => [r[0], r])); // hash -> row

  const rows = roster
    .map(([studentId, hash]) => {
      const row = byHash.get(hash) || [];
      return { studentId, hash, xp: Number(row[2]) || 0, level: Number(row[3]) || 1, completed: Number(row[4]) || 0, matched: Boolean(row[2]) };
    })
    .sort((a, b) => b.xp - a.xp);

  console.log("\n===== Nexus · 智课 — Teacher Local Settlement =====");
  console.log(`Matched ${rows.filter((r) => r.matched).length}/${roster.length} students\n`);
  for (const r of rows) {
    console.log(
      `${r.matched ? "✓" : "✗"} ${r.studentId.padEnd(10)} Lv.${r.level}  XP ${String(r.xp).padStart(4)}  关卡 ${r.completed}/3${r.matched ? "" : "  (hash not found on server)"}`,
    );
  }

  const csv = ["student_id,xp,level,completed_levels", ...rows.map((r) => `${r.studentId},${r.xp},${r.level},${r.completed}`)].join("\n");
  const outFile = join(process.cwd(), "grades.csv");
  await writeFile(outFile, csv + "\n", "utf8");
  console.log(`\nWrote ${outFile} — keep it on your machine, never upload it.`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
