// token-radar-01 entry: read the sealed snapshot, rank pre-token protocols, write the
// dashboard and the dossier. Node 22, standard library only, no network at run time.
//
// Local run:
//   mkdir -p out
//   MAKEFUN_OUTPUT_DIR=out node main.ts --input ../token-radar-01-kit/input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildRadar, dataScript, parseSnapshot, selfCheck } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const TEXT_MAX_BYTES = 65_536;
const SHOT_CAPS = { max: 4, max_bytes: 524_288 };
const DASHBOARD_CAPS = { max_files: 400, max_bytes: 4_194_304 };
const FILE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** Read --name value, --name=value, or a fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const joined = process.argv.find((a) => a.startsWith(`--${name}=`));
  return joined === undefined ? fallback : joined.slice(name.length + 3);
}

const inputArg = arg('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  process.stderr.write(`radar: no snapshot at ${inputFile}. Pass --input <file|directory>.\n`);
  process.exit(2);
}

const outputDir = arg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');
const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const built = buildRadar(snapshot);
const problem = selfCheck(built.board, snapshot);
if (problem !== null) {
  process.stderr.write(`radar: the board would fail the gate: ${problem}\n`);
  process.exit(1);
}

mkdirSync(outputDir, { recursive: true });
writeFileSync(join(outputDir, 'board.json'), `${JSON.stringify({ rows: built.board })}\n`);
writeFileSync(join(outputDir, 'data.js'), dataScript(built));

/** Copy regular files from one directory, skipping dot names. */
function copyDirectory(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const names: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const source = join(from, name);
    if (!statSync(source).isFile()) continue;
    copyFileSync(source, join(to, name));
    names.push(name);
  }
  return names;
}

copyDirectory(join(here, 'dashboard'), join(outputDir, 'dashboard'));
const shots = copyDirectory(join(here, 'screenshots'), join(outputDir, 'screenshots'));
if (shots.length < 3 || shots.length > 4) {
  process.stderr.write(`radar: ${shots.length} screenshots; the gate wants 3 or 4 board, detail and filter captures.\n`);
  process.exit(1);
}
for (const name of shots) {
  if (!FILE_NAME.test(name)) {
    process.stderr.write(`radar: bad screenshot name ${name}.\n`);
    process.exit(1);
  }
}

writeFileSync(
  join(outputDir, 'dossier.json'),
  buildDossier(outputDir, {
    text_max_bytes: TEXT_MAX_BYTES,
    screenshots: SHOT_CAPS,
    dashboard: DASHBOARD_CAPS,
  }),
);

process.stdout.write(
  `radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} watchlist, ` +
    `${built.board.length} ranked, ${built.live.length} live comparables, ${built.aside.length} set aside\n` +
    `radar: wrote board.json, data.js, dashboard/, screenshots/ (${shots.length}) and dossier.json\n`,
);
