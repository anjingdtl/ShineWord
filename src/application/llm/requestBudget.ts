import type { LlmRole } from './types';

export interface PhysicalRequestLog {
  index: number;
  role: LlmRole;
}

export class TurnRequestBudget {
  private readonly requests: PhysicalRequestLog[] = [];

  constructor(private readonly maximum = 4) {
    if (!Number.isInteger(maximum) || maximum < 1) {
      throw new Error('maximum request count must be a positive integer.');
    }
  }

  consume(role: LlmRole): PhysicalRequestLog {
    if (this.requests.length >= this.maximum) {
      throw new Error(`Turn request budget exceeded: maximum ${this.maximum} physical requests.`);
    }
    const entry = { index: this.requests.length + 1, role };
    this.requests.push(entry);
    return entry;
  }

  used(): number {
    return this.requests.length;
  }

  remaining(): number {
    return this.maximum - this.requests.length;
  }

  snapshot(): readonly PhysicalRequestLog[] {
    return this.requests.map(entry => ({ ...entry }));
  }
}
