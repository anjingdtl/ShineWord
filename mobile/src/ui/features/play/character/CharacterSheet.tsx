/**
 * CharacterSheet — the shared character-card frame (plan §21.1/§21.2).
 *
 * Identity, badges, resources and conditions for one actor projection. Later
 * P4 stages append their own sections as children (skills + training, abilities,
 * equipment, relations), so the frame stays the single place that defines how a
 * card starts.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { ActorUiProjection } from '../../../../../src/application/campaign/playProjection';
import type { CompanionDirective } from '../../../../../src/domain/characters/card';
import { Bar } from '../../components/Bar';
import { Card } from '../../components/Card';
import { SectionHeader } from '../../components/SectionHeader';
import { typeStyle } from '../../components/typography';
import { useTheme } from '../../theme/ThemeContext';

const KIND_LABEL: Record<string, string> = {
  canon: '原著角色',
  original: '原创角色',
  companion: '同伴',
  npc: 'NPC',
  creature: '生物',
};

const TIER_LABEL: Record<string, string> = {
  ordinary: '凡俗',
  enhanced: '强化',
  supernatural: '超凡',
};

const LIFE_LABEL: Record<string, string> = {
  active: '正常',
  incapacitated: '失能',
  critical: '濒危',
  dead: '已结束',
};

const DIRECTIVE_LABEL: Record<CompanionDirective, string> = {
  follow: '跟随',
  support: '支援',
  protect: '保护',
  conserve: '节省资源',
  retreat: '撤退',
};

const ATTRIBUTE_LABELS: Record<string, string> = {
  physique: '体魄',
  agility: '敏捷',
  insight: '洞察',
  knowledge: '学识',
  willpower: '意志',
  social: '交涉',
};

export function CharacterSheet(props: {
  actor: ActorUiProjection;
  /** Marks the player's own card (accent ring on the emblem). */
  isPlayer?: boolean;
  /** Extra sections (skills, abilities, equipment, relations). */
  children?: React.ReactNode;
}): React.JSX.Element {
  const { theme } = useTheme();
  const { actor } = props;
  const hpMax = actor.resourceMax.hp ?? 0;
  const staminaMax = actor.resourceMax.stamina ?? 0;

  return (
    <View style={{ gap: theme.space.md }}>
      <Card>
        <View style={[styles.head, { gap: theme.space.md }]}>
          <View
            style={{
              width: theme.space.xxl * 1.5,
              height: theme.space.xxl * 1.5,
              borderRadius: theme.radius.pill,
              alignItems: 'center',
              justifyContent: 'center',
              borderWidth: 1.5,
              borderColor: props.isPlayer ? theme.accent.primary : theme.accent.secondary,
              backgroundColor: theme.bg.overlay,
            }}>
            <Text style={[typeStyle(theme, theme.type.title), { color: theme.accentText }]}>
              {actor.name.slice(0, 1)}
            </Text>
          </View>
          <View style={{ flex: 1, gap: theme.space.xs }}>
            <Text style={[typeStyle(theme, theme.type.title), { color: theme.onRaised.primary }]}>
              {actor.name}
            </Text>
            <Text style={[typeStyle(theme, theme.type.caption), { color: theme.onRaised.secondary }]}>
              {KIND_LABEL[actor.kind] ?? actor.kind}
              {actor.originId ? ` · 出身 ${actor.originId}` : ''}
              {actor.pathId ? ` · 道途 ${actor.pathId}` : ''}
            </Text>
            <View style={[styles.badges, { gap: theme.space.xs }]}>
              <Badge text={TIER_LABEL[actor.powerTier] ?? actor.powerTier} />
              <Badge text={`防御 ${actor.defense}`} />
              <Badge text={actor.groupId === 'main' ? '主队' : `分队 ${actor.groupId}`} />
              {actor.companionDirective ? (
                <Badge text={`指令 ${DIRECTIVE_LABEL[actor.companionDirective]}`} />
              ) : null}
            </View>
          </View>
        </View>
      </Card>

      <Card>
        <SectionHeader
          title="资源"
          subtitle={`${LIFE_LABEL[actor.lifeStatus] ?? actor.lifeStatus}${
            actor.conditions.length > 0 ? ` · ${actor.conditions.join('、')}` : ''
          }`}
        />
        <Bar
          ratio={hpMax > 0 ? (actor.resources.hp ?? 0) / hpMax : 0}
          label="气血"
          valueText={`${actor.resources.hp ?? '?'} / ${hpMax || '?'}`}
        />
        <Bar
          ratio={staminaMax > 0 ? (actor.resources.stamina ?? 0) / staminaMax : 0}
          variant="alt"
          label="体力"
          valueText={`${actor.resources.stamina ?? '?'} / ${staminaMax || '?'}`}
        />
        {actor.conditions.length > 0 ? (
          <View style={[styles.badges, { gap: theme.space.xs, marginTop: theme.space.xs }]}>
            {actor.conditions.map(condition => (
              <Badge
                key={condition}
                text={
                  condition === 'disabled'
                    ? '⛔ 失能'
                    : condition === 'wounded'
                      ? '⚠ 受伤'
                      : condition
                }
                tone="warn"
              />
            ))}
          </View>
        ) : (
          <Text style={[typeStyle(theme, theme.type.caption), { color: theme.onRaised.secondary }]}>
            当前没有异常状态。
          </Text>
        )}
      </Card>

      <Card>
        <SectionHeader title="属性" subtitle="六维 1–3" />
        <View style={[styles.attributes, { gap: theme.space.xs }]}>
          {Object.entries(ATTRIBUTE_LABELS).map(([key, label]) => (
            <View
              key={key}
              style={[styles.attributeRow, { gap: theme.space.sm }]}>
              <Text
                style={[
                  typeStyle(theme, theme.type.small),
                  { color: theme.onRaised.secondary, width: theme.space.xxl + theme.space.xs },
                ]}>
                {label}
              </Text>
              <Text
                style={[
                  typeStyle(theme, theme.type.small),
                  { color: theme.onRaised.primary, fontFamily: theme.font.numeric },
                ]}>
                {actor.attributes[key] ?? '—'}
              </Text>
            </View>
          ))}
        </View>
      </Card>

      {props.children}
    </View>
  );
}

function Badge(props: { text: string; tone?: 'normal' | 'warn' }): React.JSX.Element {
  const { theme } = useTheme();
  const color = props.tone === 'warn' ? theme.semantic.warn : theme.accentText;
  return (
    <View
      style={{
        paddingHorizontal: theme.space.sm,
        paddingVertical: 2,
        borderRadius: theme.radius.pill,
        borderWidth: theme.border.hairline,
        borderColor: color,
      }}>
      <Text style={[typeStyle(theme, theme.type.micro), { color }]}>{props.text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'flex-start' },
  badges: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
  attributes: { flexDirection: 'row', flexWrap: 'wrap' },
  attributeRow: { flexDirection: 'row', alignItems: 'center', width: '45%' },
});