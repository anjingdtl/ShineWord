/**
 * Typed turn material contract (`turn-material-1`, PROTOCOL_BASELINE.md §1).
 *
 * Replaces string-label material identification (plan B02): every candidate
 * carries a discriminated kind, a source identity, an authority domain and a
 * visibility scope. Payloads are produced by trusted renderers only; model
 * or world-package text can never invent a kind. Unknown kinds are rejected
 * with diagnostics, never silently dropped.
 */

export const TURN_MATERIAL_SCHEMA_VERSION = 'turn-material-1';

export type TurnMaterialKind =
  | 'rule_summary'
  | 'situation'
  | 'available_actions'
  | 'actor_state'
  | 'world_entry'
  | 'current_objective'
  | 'character_relationship'
  | 'pending_bridge'
  | 'recent_text'
  | 'relevant_recall'
  | 'style'
  | 'task_requirement';

export const TURN_MATERIAL_KINDS: readonly TurnMaterialKind[] = [
  'rule_summary',
  'situation',
  'available_actions',
  'actor_state',
  'world_entry',
  'current_objective',
  'character_relationship',
  'pending_bridge',
  'recent_text',
  'relevant_recall',
  'style',
  'task_requirement',
];

/** Authority domain: which owner is responsible for this material (plan §4.1). */
export type AuthorityDomain =
  | 'rules'
  | 'committed_state'
  | 'world_baseline'
  | 'viewer_knowledge'
  | 'story_memory'
  | 'style';

/** Visibility scope locked before relevance and budget (plan §9.3). */
export type VisibilityScope = 'public' | 'party' | 'gm';

export type MaterialRetention = 'mandatory' | 'preferred' | 'optional';

export type RenderPolicy = 'whole_item' | 'evidence_excerpt' | 'structured_projection';

export interface MaterialSourceIdentity {
  /** Where the material originates: world package, campaign config or branch history. */
  origin: 'world' | 'campaign' | 'branch';
  /** Trusted producer type, e.g. 'world_package', 'committed_event', 'story_checkpoint'. */
  sourceType: string;
  /** Stable record id inside the producer. */
  recordId: string;
  /** Producer revision when the source is versioned. */
  revision?: string;
  /** Committed-evidence range this material covers, when applicable. */
  versionRange?: { from: number; to: number };
  /** Hash of the exact source content, when the source is text evidence. */
  evidenceHash?: string;
}

export interface CommittedEvidenceRange {
  fromStateVersion: number;
  toStateVersion: number;
}

export interface TurnMaterialCandidate {
  id: string;
  kind: TurnMaterialKind;
  source: MaterialSourceIdentity;
  authorityDomain: AuthorityDomain;
  visibility: VisibilityScope;
  coverage?: CommittedEvidenceRange;
  entityIds: readonly string[];
  retention: MaterialRetention;
  renderPolicy: RenderPolicy;
  relevance: number;
  dependencies: readonly string[];
  payload: Readonly<Record<string, unknown>>;
  /** SHA-256 over the canonical payload; identity for dedupe and freeze. */
  contentHash: string;
}

export type TurnMaterialDiagnosticCode =
  | 'unknown_material_label'
  | 'unknown_material_kind'
  | 'empty_payload'
  | 'missing_dependency'
  | 'visibility_conflict';

export interface TurnMaterialDiagnostic {
  code: TurnMaterialDiagnosticCode;
  /** Human-readable detail; includes enough information to locate the input. */
  detail: string;
}

export function isTurnMaterialKind(value: unknown): value is TurnMaterialKind {
  return typeof value === 'string' && (TURN_MATERIAL_KINDS as readonly string[]).includes(value);
}
