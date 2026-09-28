/**
 * CompanionCharacterSheet — a companion's card (plan §21.2).
 *
 * Same frame as the player's card plus the directive picker: the five
 * rule-domain orders are adjustable from the card, so party management never
 * has to live on the main play surface.
 */
import React from 'react';
import type {
  ActorUiProjection,
  PlayUiProjection,
} from '../../../../../../src/application/campaign/playProjection';
import type { CompanionDirective } from '../../../../../../src/domain/characters/card';
import { CharacterSheet } from './CharacterSheet';
import {
  AbilitySlots,
  DirectiveSection,
  EquipmentSection,
  SkillSection,
} from './CharacterSections';

export function CompanionCharacterSheet(props: {
  projection: PlayUiProjection;
  actor: ActorUiProjection;
  busy?: boolean;
  onSetDirective: (directive: CompanionDirective) => void;
}): React.JSX.Element {
  const { actor } = props;
  return (
    <CharacterSheet actor={actor}>
      <DirectiveSection
        actor={actor}
        busy={props.busy}
        onSetDirective={props.onSetDirective}
      />
      <SkillSection
        skills={props.projection.skills.filter(skill => skill.actorId === actor.actorId)}
        busy={props.busy}
      />
      <AbilitySlots actor={actor} stateVersion={props.projection.stateVersion} />
      <EquipmentSection items={props.projection.inventory} actorId={actor.actorId} />
    </CharacterSheet>
  );
}