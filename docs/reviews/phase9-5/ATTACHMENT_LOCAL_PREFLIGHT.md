# Phase 9.5 — User-supplied source preflight

**Date:** 2026-10-11
**Scope:** Local format, decoding, chapter-slice and import checks only

## Source handling

- The supplied novel is a GB18030-encoded text file. Its prose was kept outside the repository and was not printed, committed, or sent to a model.
- The companion GLM test document is a DOCX file. No key was extracted or used from it; the existing real-model smoke requires a separately supplied local key configuration.
- No real model, external endpoint, private user database, or Phase 9 request balance was used.

## Safety issue found and fixed

The prior `scripts/llm-smoke.cjs` implementation decoded input as UTF-8 and returned the entire file when no chapter heading was detected. Reproducing its decoding behavior on the supplied GB18030 file produced replacement characters and zero detected chapter headings. Running that implementation against this input could therefore have passed the whole novel into the model pipeline.

The harness now accepts explicit `--encoding utf-8|gb18030`, rejects decoding errors and missing chapter headings, and enforces a default 256 KiB post-slice input limit before any key configuration is read. `--dry-extract` now runs without a key file and uses only the local import path.

## Offline result

Command shape (the attachment path is intentionally omitted):

```sh
node scripts/llm-smoke.cjs --dry-extract --novel <local-file> \
  --encoding gb18030 --chapters 12 --max-input-bytes 262144
```

Result: `PASS`. The source file was 7,178,905 bytes; the bounded UTF-8 sample was 79,055 bytes and contained 12 detected chapter headings. The streaming importer parsed 13 content segments including the preface segment. The controlled extractor emitted only segment counts and lengths. No external request was made.

The helper regression suite covers GB18030 slicing, fatal decode failure, missing headings, and byte-cap rejection: 4 passed, 0 failed.

## Live model gate

Live GLM extraction and novel-quality evaluation remain `NOT RUN`. The sample size is prepared, but this run has no separately approved request-count and spend caps. The companion DOCX is not a key configuration input; no credential was extracted or used from it.
