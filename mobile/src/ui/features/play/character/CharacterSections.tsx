/**
 * Character-card sections (plan §21.1/§21.2).
 *
 * Each section renders one projection block with real values only:
 *   · skills    — die face, rank, rank ladder and the real practice progress
 *                 (`practicePoints / PRACTICE_THRESHOLDS[rank]`), plus the
 *                 training action for the player's own card (plan §25.2);
 *   · abilities — the four prepared slots with cooldown expiry;
 *   · equipment — the actor's items and where they came from;
 *   · relations — the actor's visible relationships, always by display name;
 *   · directive — the companion's five-state order, adjustable from the card.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type {
  ActorSkillProgressView,
  ActorUiProjection,
  InventoryView,
  RelationshipView,
} from '../../../../../../src/application/campaign/playProjection';
import type { CompanionDirective } from '../../../../../../src/domain/characters/card';
import { Bar, DieBadge } from '../../../components/Bar';
import { Button } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { Chip } from '../../../components/Chip';
import { PipTrack } from '../../../components/PipTrack';
import { SectionHeader } from '../../../components/SectionHeader';
import { typeStyle } from '../../../components/typography';
import { useTheme } from '../../../theme/ThemeContext';

const RANK_LABEL: Record<string, string> = {
  untrained: '未受训',
  novice: '入门',
  trained: '熟练',
  expert: '精通',
  master: '大师',
};

/** Five-step rank ladder, matching SKILL_RANKS order in the rule domain. */
const RANK_ORDER = ['untrained', 'novice', 'trained', 'expert', 'master'] as const;

const SOURCE_LABEL: Record<string, string> = {
  starting_loadout: '开局装备',
  recruitment: '招募携带',
  quest_reward: '任务奖励',
  encounter_loot: '遭遇战利品',
  transfer: '队友转交',
};

const DIRECTIVES: ReadonlyArray<{ value: CompanionDirective; label: string }> = [
  { value: 'follow', label: '跟随' },
  { value: 'support', label: '支援' },
  { value: 'protect', label: '保护' },
  { value: 'conserve', label: '节省资源' },
  { value: 'retreat', label: '撤退' },
];

export function SkillSection(props: {
  skills: ActorSkillProgressView[];
  /** Player cards may train; companion cards are read-only. */
  onTrain?: (skillId: string) => void;
  busy?: boolean;
}): React.JSX.Element {
  const { theme } = useTheme();
  return (
    <Card>
      <SectionHeader
        title="技能"
        subtitle={
          props.onTrain
            ? '练习点达到阈值后可训练提升（消耗时间与体力）'
            : '练习点由游戏内使用累积'
        }
      />
      {props.skills.length === 0 ? (
        <Text style={[typeStyle(theme, theme.type.small), { color: theme.onRaised.secondary }]}>
          还没有已掌握或练习中的技能。
        </Text>
      ) : (
        <View style={{ gap: theme.space.md }}>
          {props.skills.map(skill => {
            const rankIndex = RANK_ORDER.indexOf(skill.rank);
            return (
              <View key={skill.skillId} style={{ gap: theme.space.xs }}>
                <View style={[styles.row, { gap: theme.space.sm }]}>
                  <DieBadge sides={skill.dieSides} />
                  <Text
                    style={[
                      typeStyle(theme, theme.type.small),
                      { color: theme.onRaised.primary, fontWeight: '700', flex: 1 },
                    ]}>
                    {skill.name}
                  </Text>
                  <Text style={[typeStyle(theme, theme.type.caption), { color: theme.accentText }]}>
                    {RANK_LABEL[skill.rank] ?? skill.rank}
                  </Text>
                </View>
                <View style={[styles.row, { gap: theme.space.sm }]}>
                  <PipTrack
                    total={RANK_ORDER.length}
                    on={rankIndex >= 0 ? rankIndex + 1 : 0}
                    accessibilityLabel={`${skill.name} 等阶 ${RANK_LABEL[skill.rank] ?? skill.rank}`}
                  />
                  <Text
                    style={[
                      typeStyle(theme, theme.type.micro),
                      { color: theme.onRaised.secondary, fontFamily: theme.font.numeric },
                    ]}>
                    {skill.threshold === null
                      ? '已至终阶'
                      : `练习 ${skill.practicePoints} / ${skill.threshold}`}
                  </Text>
                </View>
                {skill.threshold !== null ? (
                  <Bar ratio={skill.practicePoints / skill.threshold} variant="alt" />
                ) : null}
                {props.onTrain ? (
                  <Button
                    label="训练（消耗时间与体力）"
                    variant="secondary"
                    onPress={() => props.onTrain?.(skill.skillId)}
                    disabled={props.busy === true}
                    testID={`train-${skill.skillId}`}
                  />
                ) : null}
              </View>
            );
          })}
        </View>
      )}
    </Card>
  );
}

export function AbilitySlots(props: {
  actor: ActorUiProjection;
  /** Current branch state version, used to tell active cooldowns. */
  stateVersion: number;
}): React.JSX.Element {
  const { theme } = useTheme();
  const slots = Math.max(props.actor.preparedAbilitySlots, props.actor.preparedAbilities.length);
  const entries = Array.from({ length: slots }, (_, index) => props.actor.preparedAbilities[index] ?? null);
  return (
    <Card>
      <SectionHeader title="能力 · 预备槽" subtitle={`${props.actor.preparedAbilities.length} / ${slots}`} />
      <View style={[styles.slots, { gap: theme.space.sm }]}>
        {entries.map((ability, index) => {
          const cooling = ability?.cooldownExpiresAtVersion !== null &&
            ability?.cooldownExpiresAtVersion !== undefined &&
            ability.cooldownExpiresAtVersion > props.stateVersion;
          return (
            <View
              key={ability?.abilityId ?? `empty-${index}`}
              style={[
                styles.slot,
                {
                  borderColor: ability ? theme.border.colorStrong : theme.border.color,
                  borderStyle: ability ? 'solid' : 'dashed',
                  borderWidth: theme.border.hairline,
                  borderRadius: theme.radius.md,
                  backgroundColor: theme.bg.overlay,
                  padding: theme.space.sm,
                  opacity: ability ? 1 : 0.45,
                },
              ]}>
              <Text
                numberOfLines={2}
                style={[
                  typeStyle(theme, theme.type.caption),
                  { color: ability ? theme.onRaised.primary : theme.onRaised.secondary, textAlign: 'center' },
                ]}>
                {ability ? ability.name : '空槽'}
              </Text>
              {cooling && ability?.cooldownExpiresAtVersion != null ? (
                <Text style={[typeStyle(theme, theme.type.micro), { color: theme.semanticText.warn }]}>
                  冷却中 v{ability.cooldownExpiresAtVersion}
                </Text>
              ) : null}
            </View>
          );
        })}
      </View>
    </Card>
  );
}

export function EquipmentSection(props: {
  items: InventoryView[];
  actorId: string;
}): React.JSX.Element {
  const { theme } = useTheme();
  const owned = props.items.filter(item => item.ownerActorId === props.actorId);
  return (
    <Card>
      <SectionHeader title="装备与物品" subtitle={owned.length > 0 ? `${owned.length} 件` : '暂无'} />
      {owned.length === 0 ? (
        <Text style={[typeStyle(theme, theme.type.small), { color: theme.onRaised.secondary }]}>
          当前没有持有的物品记录。
        </Text>
      ) : (
        <View style={{ gap: theme.space.xs }}>
          {owned.map(item => (
            <View key={item.itemId} style={[styles.row, { gap: theme.space.sm }]}>
              <Text style={[typeStyle(theme, theme.type.small), { color: theme.onRaised.primary, flex: 1 }]}>
                {item.name}
              </Text>
              <Text style={[typeStyle(theme, theme.type.caption), { color: theme.onRaised.secondary }]}>
                {item.source ? SOURCE_LABEL[item.source.kind] ?? item.source.kind : '来源未记录'}
                {item.source ? ` · ${item.source.sourceId}` : ''}
              </Text>
            </View>
          ))}
        </View>
      )}
    </Card>
  );
}

export function RelationshipSection(props: {
  actorId: string;
  relationships: RelationshipView[];
  actorNames: Record<string, string>;
}): React.JSX.Element {
  const { theme } = useTheme();
  const related = props.relationships.filter(
    rel => rel.fromActorId === props.actorId || rel.toActorId === props.actorId,
  );
  return (
    <Card>
      <SectionHeader title="关系" subtitle={related.length > 0 ? `${related.length} 条` : '暂无记录'} />
      {related.length === 0 ? (
        <Text style={[typeStyle(theme, theme.type.small), { color: theme.onRaised.secondary }]}>
          还没有可展示的关系记录。
        </Text>
      ) : (
        <View style={{ gap: theme.space.sm }}>
          {related.map(rel => {
            const otherId = rel.fromActorId === props.actorId ? rel.toActorId : rel.fromActorId;
            const outgoing = rel.fromActorId === props.actorId;
            const label = props.actorNames[otherId] ?? otherId;
            return (
              <View key={rel.relId} style={{ gap: theme.space.xs }}>
                <View style={[styles.row, { gap: theme.space.sm }]}>
                  <Text style={[typeStyle(theme, theme.type.small), { color: theme.onRaised.primary, flex: 1 }]}>
                    {outgoing ? `对 ${label}` : `${label} 对你`}
                  </Text>
                  <Text style={[typeStyle(theme, theme.type.caption), { color: theme.accentText }]}>
                    {rel.stance}
                  </Text>
                </View>
                <Bar
                  // closeness is documented as -100..100; the bar shows the 0..100 range.
                  ratio={Math.max(0, Math.min(100, rel.closeness)) / 100}
                  label="亲密"
                  valueText={String(rel.closeness)}
                />
              </View>
            );
          })}
        </View>
      )}
    </Card>
  );
}

export function DirectiveSection(props: {
  actor: ActorUiProjection;
  busy?: boolean;
  onSetDirective: (directive: CompanionDirective) => void;
}): React.JSX.Element {
  const { theme } = useTheme();
  return (
    <Card>
      <SectionHeader
        title="同伴指令"
        subtitle={`当前：${
          DIRECTIVES.find(option => option.value === props.actor.companionDirective)?.label ?? '保护（默认）'
        }`}
      />
      <View style={[styles.wrap, { gap: theme.space.sm }]}>
        {DIRECTIVES.map(option => (
          <Chip
            key={option.value}
            label={option.label}
            selected={props.actor.companionDirective === option.value}
            disabled={props.busy === true}
            onPress={() => props.onSetDirective(option.value)}
            testID={`sheet-directive-${option.value}`}
          />
        ))}
      </View>
      <Text
        style={[
          typeStyle(theme, theme.type.caption),
          { color: theme.onRaised.secondary, marginTop: theme.space.sm },
        ]}>
        指令决定同伴在确定性战斗中的行为倾向，可随时调整。
      </Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  slots: { flexDirection: 'row', flexWrap: 'wrap' },
  slot: { width: '22%', minWidth: 72, alignItems: 'center', gap: 4, paddingVertical: 10 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
});