import { canonicalStringify, type CanonicalJson } from '../../domain/turns/canonical';
import type { OpeningRequirementsV1, SourceRangeV1 } from '../../domain/build/phase6';
import type { SegmentArtifactV1 } from '../../domain/content/segmentArtifact';
import type { ContentEntry } from '../../domain/content/types';
import type { StoredEntity, StoredEvent, StoredFact } from '../ports/worldStore';
import { validatePackage } from '../worldPackage/validate';
import { evaluatePlayabilityGate } from '../worldPackage/playabilityGate';
import { isSegmentArtifactV1, rangeCovered } from './protocol';

export interface PublicationReviewIssueV1 {
  issueId:string; severity:string;
  /** Unclassified legacy/global blockers intentionally remain blocking. */
  entryIds?:readonly string[]; factIds?:readonly string[]; ranges?:readonly SourceRangeV1[];
  scopeProvenComplete?:boolean;
}
export function validateSegmentArtifactContent(input:{artifact:SegmentArtifactV1;dependencyEntries:readonly ContentEntry[];
  facts:readonly StoredFact[];entities:readonly StoredEntity[];events:readonly StoredEvent[];
  blockingReviews:readonly PublicationReviewIssueV1[];openingRequirements?:OpeningRequirementsV1}):{errors:string[];warnings:string[]} {
  const {artifact:a}=input; const errors:string[]=[];
  if(!isSegmentArtifactV1(a)) return {errors:['invalid_artifact_structure'],warnings:[]};
  const known=new Map(input.dependencyEntries.map(e=>[e.entryId,e]));
  for(const e of a.entries) {
    const prior=known.get(e.entryId);
    if(prior&&canonicalStringify(prior as unknown as CanonicalJson)!==canonicalStringify(e as unknown as CanonicalJson))errors.push(`immutable_entry_exists:${e.entryId}`);
    else known.set(e.entryId,e);
  }
  const report=validatePackage({worldId:a.worldId,revision:a.basePackage.revision},[...known.values()],a.sections);
  errors.push(...report.errors);
  const factById=new Map(input.facts.map(f=>[f.factId,f]));
  const entries=new Set(a.entries.map(e=>e.entryId)); const usedFacts=new Set(a.citations.flatMap(c=>c.sourceFactIds));
  for(const e of a.entries) {
    if(e.revision!==a.basePackage.revision) errors.push(`entry_revision_mismatch:${e.entryId}`);
    for(const [field,p] of [['provenance',e.provenance],...Object.entries(e.fieldProvenance).map(([k,p])=>[`fieldProvenance.${k}`,p] as const)] as const) {
      const citation=a.citations.find(c=>c.entryId===e.entryId&&c.field===field);
      if(!citation){errors.push(`missing_citation_binding:${e.entryId}:${field}`);continue;}
      if(citation.sourceFactIds.length!==p.sourceFactIds.length||!p.sourceFactIds.every(id=>citation.sourceFactIds.includes(id)))
        errors.push(`citation_fact_mismatch:${e.entryId}:${field}`);
      if(['explicit','inferred'].includes(p.kind)&&citation.ranges.length===0) errors.push(`source_proof_required:${e.entryId}:${field}`);
      if(p.kind==='user_override') errors.push(`branch_override_in_world_artifact:${e.entryId}:${field}`);
      if(p.kind==='explicit'&&p.sourceFactIds.some(id=>factById.get(id)?.status!=='explicit')) errors.push(`inference_disguised_as_explicit:${e.entryId}:${field}`);
      for(const factId of p.sourceFactIds) {
        const fact=factById.get(factId);
        if(!fact||fact.worldId!==a.worldId||!['explicit','inference'].includes(fact.status)||!fact.sources.length)
          errors.push(`invalid_source_fact:${e.entryId}:${factId}`);
      }
      for(const r of citation.ranges) if(!rangeCovered(r,a.coverage)) errors.push(`citation_outside_coverage:${e.entryId}:${field}`);
    }
  }
  const expectedCitationCount=a.entries.reduce((n,e)=>n+1+Object.keys(e.fieldProvenance).length,0);
  if(expectedCitationCount!==a.citations.length) errors.push('unexpected_citation_binding');
  for(const review of input.blockingReviews.filter(i=>i.severity==='blocking')) {
    const classified=review.scopeProvenComplete===true && ((review.entryIds?.length??0)+(review.factIds?.length??0)+(review.ranges?.length??0)>0);
    const relevant=!classified||review.entryIds?.some(id=>entries.has(id)||known.has(id))||review.factIds?.some(id=>usedFacts.has(id))
      ||review.ranges?.some(r=>a.coverage.some(c=>r.sourceId===c.sourceId&&r.normalizedTreeHash===c.normalizedTreeHash&&r.startCp<c.endCp&&r.endCp>c.startCp));
    if(relevant) errors.push(`blocking_review:${review.issueId}`);
  }
  if(input.openingRequirements) {
    const req=input.openingRequirements;
    const cited=input.facts.filter(f=>usedFacts.has(f.factId)&&f.worldId===a.worldId&&['explicit','inference'].includes(f.status)&&f.sources.length>0);
    const citedChapters=new Set(cited.flatMap(f=>f.sources.map(source=>source.chapterId)));
    const openingEvents=input.events.filter(e=>e.worldId===a.worldId&&e.status==='canon'
      &&e.narrativeChapterId!==null&&citedChapters.has(e.narrativeChapterId));
    const eventById=new Map(openingEvents.map(e=>[e.eventId,e]));
    for(const id of req.requiredEntryIds) if(!known.has(id))errors.push(`opening_entry_missing:${id}`);
    for(const id of req.requiredEntityIds) {
      if(!input.entities.some(e=>e.worldId===a.worldId&&e.entityId===id))errors.push(`opening_entity_missing:${id}`);
      else if(!cited.some(f=>f.subjectEntityId===id))errors.push(`opening_entity_unproven:${id}`);
    }
    for(const id of req.requiredFactIds) if(!factById.has(id)||!usedFacts.has(id))errors.push(`opening_fact_missing:${id}`);
    for(const id of req.requiredEventIds) {
      const event=eventById.get(id);
      if(!event)errors.push(`opening_event_missing:${id}`);
      else for(const dependency of event.dependsOnEventIds)if(!eventById.has(dependency))errors.push(`opening_event_dependency_missing:${id}:${dependency}`);
    }
    for(const r of req.ranges) if(!rangeCovered(r,a.coverage))errors.push('opening_range_missing');
    const gate=evaluatePlayabilityGate({entities:input.entities.filter(e=>e.worldId===a.worldId),facts:cited,eventCount:openingEvents.length,
      openBlockingReviewIssues:errors.filter(e=>e.startsWith('blocking_review:')).length});
    if(!gate.playable)errors.push(...gate.reasons.map(reason=>`opening_gate:${reason}`));
    const openingScene=a.entries.find(e=>e.kind==='scene'&&e.visibility==='public');
    if(!openingScene)errors.push('opening_scene_missing');
    else {
      const def=openingScene.definition as {locationId?:string;actors?:readonly string[];questIds?:readonly string[]};
      const locations=input.entities.filter(e=>e.worldId===a.worldId&&e.type==='location'&&(e.entityId===def.locationId||e.name===def.locationId));
      if(locations.length!==1||!cited.some(f=>f.subjectEntityId===locations[0]!.entityId))errors.push('opening_location_unproven');
      const supportedAction=(id:string,kind:'actor_template'|'quest'):boolean=>{
        const entry=known.get(id);
        if(entry?.kind!==kind||entry.provenance.kind==='design_fill'||entry.provenance.kind==='user_override')return false;
        const evidence=cited.filter(f=>entry.provenance.sourceFactIds.includes(f.factId));
        if(!evidence.length)return false;
        if(kind==='quest')return true;
        const characterIds=new Set(evidence.filter(f=>input.entities.some(e=>e.worldId===a.worldId&&e.entityId===f.subjectEntityId&&e.type==='character'))
          .map(f=>f.subjectEntityId));
        if(!characterIds.size||locations.length!==1)return false;
        const location=locations[0]!;
        return cited.some(f=>characterIds.has(f.subjectEntityId)
          &&(Object.values(f.value).some(value=>value===location.entityId||value===location.name)
            ||f.sources.some(source=>source.quote.includes(location.name)&&input.entities.some(e=>e.entityId===f.subjectEntityId&&source.quote.includes(e.name)))));
      };
      if(!(def.actors??[]).some(id=>supportedAction(id,'actor_template'))&&!(def.questIds??[]).some(id=>supportedAction(id,'quest')))errors.push('opening_interaction_missing');
      for(const id of [...(def.actors??[]),...(def.questIds??[])])if(!known.has(id)||!openingScene.dependencyIds.includes(id))errors.push(`opening_action_dependency_missing:${id}`);
    }
  }
  return {errors:[...new Set(errors)],warnings:report.warnings};
}
