'use strict';
/**
 * Performance dry-run for the world-build batch planners (NO LLM calls).
 *
 * Parses the full reference novel, then plans extraction batches with the
 * shipped planners and prints SANITIZED counters only (chapter counts, chunk
 * counts, batch counts, token estimates). Never prints novel text.
 *
 * Usage:
 *   node scripts/perf-dryrun.cjs <path-to-txt> [--label <name>] [--json <out>]
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const root = path.resolve(__dirname, '..');
const { importTxtSource } = require(path.join(root, 'dist/application/import/txtImport'));
const { computeStagePlan } = require(path.join(root, 'dist/application/worldBuild/stagePlan'));
const { planChapterBatches } = require(path.join(root, 'dist/application/worldBuild/chapterBatchPlanner'));
const { planExtractGroups, DEFAULT_MODEL_BUDGET } = require(path.join(root, 'dist/application/worldBuild/groupPlanner'));
const {
  planAnalysisBatches,
  SOURCE_RATIO_PROBE_START,
  DEFAULT_EXTRACTION_DENSITY,
} = require(path.join(root, 'dist/application/worldBuild/analysisBatchPlanner'));

const argv = process.argv.slice(2);
const fileArg = argv.find(a => !a.startsWith('--'));
const labelIdx = argv.indexOf('--label');
const jsonIdx = argv.indexOf('--json');
const label = labelIdx >= 0 ? argv[labelIdx + 1] : path.basename(fileArg ?? '');
const jsonOut = jsonIdx >= 0 ? argv[jsonIdx + 1] : null;

if (!fileArg) {
  console.error('usage: node scripts/perf-dryrun.cjs <novel.txt> [--label name] [--json out.json]');
  process.exit(1);
}

const sha = {
  sha256BytesHex: async bytes => crypto.createHash('sha256').update(bytes).digest('hex'),
};
const decoder = {
  decode: (bytes, encoding) => new TextDecoder(encoding).decode(bytes),
};

function fmtBatchStats(batches) {
  if (batches.length === 0) return { batches: 0, avgChapters: 0, avgChunks: 0, avgEstInputTokens: 0, maxChunks: 0 };
  const chapters = batches.map(b => new Set(b.segments.map(s => s.chapterId)).size);
  const chunks = batches.map(b => b.segments.length);
  const tokens = batches.map(b => b.estInputTokens);
  const avg = xs => Math.round(xs.reduce((a, b) => a + b, 0) / xs.length);
  return {
    batches: batches.length,
    avgChapters: avg(chapters),
    avgChunks: avg(chunks),
    avgEstInputTokens: avg(tokens),
    maxChunks: Math.max(...chunks),
  };
}

function fmtAnalysisStats(batches) {
  const base = fmtBatchStats(batches);
  if (batches.length === 0) return { ...base, analysisSlices: 0 };
  const slices = batches.reduce((sum, b) => sum + b.slices.length, 0);
  return { ...base, analysisSlices: slices };
}

async function main() {
  const bytes = new Uint8Array(fs.readFileSync(fileArg));
  const parsed = await importTxtSource(bytes, sha, decoder);
  const { chapters, chunks } = parsed;
  const totalCp = parsed.codePointCount;
  const estBookTokens = chunks.reduce((sum, c) => sum + Math.ceil(c.charCount), 0);

  const stagePlan = computeStagePlan(chapters, totalCp, { strategy: 'progressive' });
  const s1 = stagePlan.stages[0];
  const s1Chunks = chunks.filter(c => c.endOffset > s1.startCp && c.startOffset < s1.endCp);
  const s1Chapters = chapters.filter(c => c.endOffset > s1.startCp && c.startOffset < s1.endCp);

  const budget1M = { ...DEFAULT_MODEL_BUDGET, contextWindowTokens: 1_000_000 };
  const budget200k = { ...DEFAULT_MODEL_BUDGET, contextWindowTokens: 200_000 };

  const result = {
    label,
    byteLength: bytes.byteLength,
    codePointCount: totalCp,
    estBookInputTokens: estBookTokens,
    chapters: chapters.length,
    storageChunks: chunks.length,
    progressiveS1: {
      ratio: s1.ratio,
      chapters: s1Chapters.length,
      chunks: s1Chunks.length,
    },
    oldPlanner: {
      planVersion: 'plan-chapter-1',
      note: 'output-per-chunk model (800 tok/chunk, x0.7 usable) caps batches at ~14 storage chunks regardless of window',
      wholeBook: fmtBatchStats(planChapterBatches(chapters, chunks, budget1M)),
      wholeBook200k: fmtBatchStats(planChapterBatches(chapters, chunks, budget200k)),
      s1: fmtBatchStats(planChapterBatches(s1Chapters, s1Chunks, budget1M)),
    },
    legacyGroupPlanner: {
      note: 'planExtractGroups (pre-chapter planner) for reference',
      wholeBook: fmtBatchStats(planExtractGroups(chunks, budget1M).map((g, i) => ({ ...g, ord: i }))),
    },
    newPlanner: {
      planVersion: 'plan-analysis-1',
      note: 'chapter-first AnalysisSlices packed by token budgets (ratio probe 12%, density 6%)',
      wholeBook1M: fmtAnalysisStats(planAnalysisBatches(chapters, chunks, budget1M, {
        sourceRatio: SOURCE_RATIO_PROBE_START, density: DEFAULT_EXTRACTION_DENSITY,
      })),
      wholeBook1MGrown: fmtAnalysisStats(planAnalysisBatches(chapters, chunks, budget1M, { sourceRatio: 0.30, density: 0.06 })),
      wholeBook200k: fmtAnalysisStats(planAnalysisBatches(chapters, chunks, budget200k, {
        sourceRatio: SOURCE_RATIO_PROBE_START, density: DEFAULT_EXTRACTION_DENSITY,
      })),
      wholeBook200kGrown: fmtAnalysisStats(planAnalysisBatches(chapters, chunks, budget200k, { sourceRatio: 0.30, density: 0.06 })),
      s1: fmtAnalysisStats(planAnalysisBatches(s1Chapters, s1Chunks, budget1M, {
        sourceRatio: SOURCE_RATIO_PROBE_START, density: DEFAULT_EXTRACTION_DENSITY,
      })),
      s1Grown: fmtAnalysisStats(planAnalysisBatches(s1Chapters, s1Chunks, budget1M, { sourceRatio: 0.30, density: 0.06 })),
    },
  };

  const text = JSON.stringify(result, null, 2);
  console.log(text);
  if (jsonOut) {
    fs.mkdirSync(path.dirname(jsonOut), { recursive: true });
    fs.writeFileSync(jsonOut, text, 'utf8');
  }
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
