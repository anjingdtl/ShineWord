import type { TurnState } from '../../domain/turns/types';

export type RecoveryAction =
  | 'resume-planner'
  | 'resume-roll'
  | 'resume-narrator'
  | 'validate-candidate'
  | 'resume-repair'
  | 'remain-paused'
  | 'read-committed';

export interface TurnRecoverySnapshot {
  state: TurnState;
  hasContract: boolean;
  hasRoll: boolean;
  hasNarrativeCandidate: boolean;
  hasCommittedResult: boolean;
}

export function classifyTurnRecovery(
  snapshot: TurnRecoverySnapshot,
): RecoveryAction {
  if (snapshot.hasCommittedResult || snapshot.state === 'Committed') {
    return 'read-committed';
  }

  switch (snapshot.state) {
    case 'Draft':
      return 'resume-planner';
    case 'Planned':
      return snapshot.hasContract ? 'resume-roll' : 'resume-planner';
    case 'AwaitRoll':
      return snapshot.hasRoll ? 'resume-narrator' : 'resume-roll';
    case 'Resolved':
      return snapshot.hasRoll ? 'resume-narrator' : 'resume-roll';
    case 'Narrated':
      return snapshot.hasNarrativeCandidate ? 'validate-candidate' : 'resume-narrator';
    case 'Validated':
      return 'validate-candidate';
    case 'Repair':
      return 'resume-repair';
    case 'Paused':
      return 'remain-paused';
    case 'Committed':
      return 'read-committed';
  }
}
