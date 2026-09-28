/**
 * PlayerCharacterSheet — the player's own card (plan §21.1).
 *
 * Full projection: identity, resources, attributes, skills with real practice
 * progress, the four prepared ability slots, equipment with its source, and the
 * player's relationship rows. Training lives here (plan §25.2) — it is no longer
 * a button on the main play surface.
 */
import React from 'react';
import type { PlayUiProjection } from '../../../../../../src/application/campaign/playProjection';
import { CharacterSheet } from './CharacterSheet';
import {
  AbilitySlots,
  EquipmentSection,
  RelationshipSection,
  SkillSection,
} from './CharacterSections';

export function PlayerCharacterSheet(props: {
  projection: PlayUiProjection;
  busy?: boolean;
  onTrain: (skillId: string) => void;
}): React.JSX.Element | null {
  const actor = props.projection.player;
  if (!actor) return null;
  return (
    <CharacterSheet actor={actor} isPlayer>
      <SkillSection
        skills={props.projection.skills.filter(skill => skill.actorId === actor.actorId)}
        onTrain={props.onTrain}
        busy={props.busy}
      />
      <AbilitySlots actor={actor} stateVersion={props.projection.stateVersion} />
      <EquipmentSection items={props.projection.inventory} actorId={actor.actorId} />
      <RelationshipSection
        actorId={actor.actorId}
        relationships={props.projection.relationships}
        actorNames={props.projection.actorNames}
      />
    </CharacterSheet>
  );
}