/** Expression-only semantic fields. No endpoint, rules or knowledge controls. */
export const STYLE_COMPILER_VERSION = 'trpg-style-compiler-1' as const;
export type StyleMode = 'source' | 'preset' | 'custom';
export interface StyleSemanticV1 {
  genre: string; tone: string; audience: string;
  pointOfView: 'second_person' | 'limited_third'; narratorDistance: string; interiority: string;
  texture: string; syntax: string; vocabulary: string; paragraphStructure: string;
  environment: string; characterPresentation: string; characterVoice: string; dialogue: string;
  pacing: string; conflict: string; informationReveal: string; suspense: string; continuity: string;
  imagery: string; sensory: string; prohibitions: readonly string[]; extraInstructions: string;
  verbosity: 'concise' | 'standard' | 'rich'; recapPreference: string; actionPresentation: string;
}
export type StyleOverridesV1 = Partial<StyleSemanticV1>;
export interface ProjectStyleViewV1 {
  projectId: string; mode: StyleMode; styleId: string; styleVersion: string;
  sourceProfileVersion: string | null; userOverrideVersion: number;
  semantic: StyleSemanticV1; overrides: StyleOverridesV1;
  analysisStatus: 'pending' | 'running' | 'ready' | 'failed' | 'suggestion';
}
export interface ProjectStyleEditV1 {
  projectId: string; expectedVersion: string; mode: StyleMode; presetId?: string;
  overrides: StyleOverridesV1;
}
export interface EffectiveStyleSnapshotV1 {
  snapshotId: string; projectId: string; branchId: string; turnId: string;
  styleId: string; styleVersion: string; sourceProfileVersion: string | null;
  userOverrideVersion: number; compilerVersion: string;
  projectionLevel: 'minimal' | 'compact' | 'standard' | 'detailed';
  compiledHash: string; compiledText: string; semantic: StyleSemanticV1;
  tokenEstimate: number; sceneKind: string; participantIds: readonly string[];
}
