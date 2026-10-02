import type { ContentEntry } from '../../domain/content/types';
import type { StoredFact } from '../ports/worldStore';
import type { LocalSourceRange } from '../search/localSourceSearch';
import { isEntryVisibleAtAnchor, isTemplateValidAtAnchor } from './recruitment';

/** Explicitly reading a verified excerpt can unlock already-adopted content
 * whose entire proof is known. Publication/adoption alone grants no knowledge. */
export function segmentKnowledgeFromConfirmedEvidence(input: { entries: readonly ContentEntry[]; facts: readonly StoredFact[];
  worldTimeOrder: number; knownEntryIds: ReadonlySet<string>; knownRanges: readonly LocalSourceRange[] }): string[] {
  const facts = new Map(input.facts.map(f => [f.factId,f]));
  const covered = (chapterId: string,start: number,end: number): boolean => {
    let cursor=start;
    for (const range of input.knownRanges.filter(r=>r.chapterId===chapterId).sort((a,b)=>a.startCodePoint-b.startCodePoint)) {
      if (range.startCodePoint>cursor) break;
      cursor=Math.max(cursor,range.endCodePoint); if(cursor>=end) return true;
    }
    return false;
  };
  const allowed = new Set(input.entries.filter(e => (e.visibility==='public'||input.knownEntryIds.has(e.entryId))
    && e.visibility!=='gm' && isEntryVisibleAtAnchor(e,input.facts,input.worldTimeOrder)).map(e=>e.entryId));
  const candidates = input.entries.filter(e => e.visibility==='discoverable' && e.revealPolicyId==='segment-explicit-discovery'
    && !allowed.has(e.entryId) && isEntryVisibleAtAnchor(e,input.facts,input.worldTimeOrder)
    && (e.kind!=='actor_template'||isTemplateValidAtAnchor(e,input.worldTimeOrder))
    && e.provenance.sourceFactIds.length>0
    && [e.provenance,...Object.values(e.fieldProvenance)].every(p => p.sourceFactIds.every(id => {
      const fact=facts.get(id);return fact && ['explicit','inference'].includes(fact.status) && ['world','canon'].includes(fact.scope)
        && fact.sources.length>0 && fact.sources.every(s=>covered(s.chapterId,s.startOffset,s.endOffset));
    }) && (p.sourceRanges ?? []).every(r=>covered(r.chapterId,r.startCodePoint,r.endCodePoint))));
  const eligible = new Set(candidates.map(e=>e.entryId));
  let changed=true;
  while(changed){changed=false;for(const e of candidates) if(eligible.has(e.entryId)
    && e.dependencyIds.some(id=>!allowed.has(id)&&!eligible.has(id))){eligible.delete(e.entryId);changed=true;}}
  return [...eligible];
}
