/** Business output needs by request kind. These are demands, not capabilities. */
import type { LlmRequestKind, OutputDemand } from './requestPlan';

export const DEFAULT_OUTPUT_DEMANDS: Record<LlmRequestKind, OutputDemand> = {
  planner: { minimum: 900, target: 1_800, maximum: 4_000 },
  narrator: { minimum: 800, target: 2_500, maximum: 8_000 },
  memory_checkpoint: { minimum: 700, target: 1_600, maximum: 4_000 },
  memory_repair: { minimum: 600, target: 1_200, maximum: 3_000 },
  world_extract: { minimum: 2_000, target: 6_000, maximum: 16_000 },
  world_mapping: { minimum: 1_500, target: 4_000, maximum: 12_000 },
  world_adjudication: { minimum: 900, target: 2_000, maximum: 6_000 },
  timeline: { minimum: 800, target: 2_000, maximum: 6_000 },
  registry: { minimum: 800, target: 2_000, maximum: 8_000 },
  summarizer: { minimum: 400, target: 800, maximum: 2_000 },
};
