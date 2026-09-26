export type ActionResolutionMode = 'blocked' | 'automatic' | 'roll';

export interface ActionQualificationInput {
  violatesHardRule?: boolean;
  hasRequiredCapability?: boolean;
  uncertain?: boolean;
  consequential?: boolean;
}

export interface ActionQualification {
  mode: ActionResolutionMode;
  reason: string;
}

export function qualifyAction({
  violatesHardRule = false,
  hasRequiredCapability = true,
  uncertain = true,
  consequential = true,
}: ActionQualificationInput): ActionQualification {
  if (violatesHardRule) {
    return { mode: 'blocked', reason: 'hard_rule_violation' };
  }
  if (!hasRequiredCapability) {
    return { mode: 'blocked', reason: 'missing_capability' };
  }
  if (!uncertain || !consequential) {
    return { mode: 'automatic', reason: 'no_meaningful_risk' };
  }
  return { mode: 'roll', reason: 'risk_requires_roll' };
}
