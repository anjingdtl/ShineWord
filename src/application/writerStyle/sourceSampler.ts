import { isSourceRangeV1 } from '../../domain/build/validation';
import type { SourceStyleSample } from './ports';

export const STYLE_SAMPLER_VERSION = 'trpg-style-sampler-1';
export interface StyleHashPort { sha256Hex(text: string): Promise<string> | string }
/** Bounded bootstrap reuse, source-local CP coordinates; no full-book I/O. */
export async function sampleWriterStyleSource(samples: readonly SourceStyleSample[], hash: StyleHashPort,
  config: { maxSamples?: number; sampleCodePoints?: number } = {}): Promise<SourceStyleSample[]> {
  const maxSamples = config.maxSamples ?? 8;
  const sampleCodePoints = config.sampleCodePoints ?? 240;
  if (!Number.isInteger(maxSamples) || maxSamples < 1 || maxSamples > 10
    || !Number.isInteger(sampleCodePoints) || sampleCodePoints < 80 || sampleCodePoints > 480) throw new Error('invalid_style_sampler_config');
  if (!samples.length || samples.length > 64) throw new Error('invalid_style_samples');
  const result: SourceStyleSample[] = [];
  for (const sample of samples) {
    if (!isSourceRangeV1(sample.range) || typeof sample.text !== 'string') throw new Error('invalid_style_sample_range');
    const points = Array.from(sample.text);
    if (points.length !== sample.range.endCp - sample.range.startCp
      || await hash.sha256Hex(sample.text) !== sample.range.rangeContentHash) throw new Error('style_sample_hash_or_coordinate_mismatch');
    // Evenly spaced short excerpts retain dialogue/environment diversity while
    // keeping the actual paid input bounded. We never invent source coordinates.
    const count = Math.min(Math.ceil(points.length / sampleCodePoints), maxSamples - result.length);
    for (let i = 0; i < count; i += 1) {
      const offset = count > 1 ? Math.floor(i * Math.max(0, points.length - sampleCodePoints) / (count - 1)) : 0;
      const text = points.slice(offset, offset + sampleCodePoints).join('');
      const startCp = sample.range.startCp + offset;
      const endCp = startCp + Array.from(text).length;
      result.push({ text, range: { ...sample.range, startCp, endCp, rangeContentHash: await hash.sha256Hex(text) } });
    }
    if (result.length >= maxSamples) break;
  }
  return result;
}
