/**
 * Shared view model and constants for the opening wizard (plan §11).
 *
 * The wizard only *reads* the world setup projection and calls the unchanged
 * `createCampaign`; every limit here mirrors the rule domain (4 free points,
 * 3 starting skills, at most 2 companions) and is not re-implemented in UI.
 */
import type { CompanionDirective } from '../../../../../src/domain/characters/card';

/** Projection returned by `session.getWorldSetup()`. */
export interface OpeningWorldSetup {
  packageRevision: number | null;
  rulesetVersion: string;
  skills: Array<{ entryId: string; name: string; attribute: string; allowUntrained: boolean }>;
  lore: Array<{ name: string; text: string }>;
  anchorEvents: Array<{ eventId: string; title: string; summary: string; worldTimeOrder: number }>;
  locations: string[];
  canonCharacters: Array<{ entityId: string; name: string }>;
  companionTemplates: Array<{ entryId: string; name: string; description: string }>;
  encounterTemplates: Array<{ entryId: string; name: string }>;
}

export const ATTRIBUTES = [
  { key: 'physique', label: '体魄' },
  { key: 'agility', label: '敏捷' },
  { key: 'insight', label: '洞察' },
  { key: 'knowledge', label: '学识' },
  { key: 'willpower', label: '意志' },
  { key: 'social', label: '交涉' },
] as const;

export type AttributeKey = (typeof ATTRIBUTES)[number]['key'];

export function attributeLabel(key: string): string {
  return ATTRIBUTES.find(attribute => attribute.key === key)?.label ?? key;
}

export const COMPANION_DIRECTIVES: ReadonlyArray<{ value: CompanionDirective; label: string }> = [
  { value: 'follow', label: '跟随' },
  { value: 'support', label: '支援' },
  { value: 'protect', label: '保护' },
  { value: 'conserve', label: '节省资源' },
  { value: 'retreat', label: '撤退' },
];

export function directiveLabel(directive: CompanionDirective | undefined): string {
  return COMPANION_DIRECTIVES.find(option => option.value === directive)?.label ?? '保护';
}

export const FREE_POINT_BUDGET = 4;
export const MAX_SKILLS = 3;
export const MAX_COMPANIONS = 2;

export const WIZARD_STEPS: readonly string[] = ['世界起点', '我的角色', '同伴', '确认开局'];