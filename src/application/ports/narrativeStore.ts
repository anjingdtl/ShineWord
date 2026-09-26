import type { RollGrade } from '../../domain/rules/types';

export interface NarrativeRecord {
  branchId: string;
  turnId: string;
  outcomeGrade: RollGrade;
  text: string;
  status: 'Candidate' | 'Committed';
  createdAt: string;
}

export interface NarrativeStore {
  get(branchId: string, turnId: string): Promise<NarrativeRecord | null>;
  saveCandidate(record: Omit<NarrativeRecord, 'status'>): Promise<NarrativeRecord>;
  markCommitted(branchId: string, turnId: string): Promise<void>;
}
