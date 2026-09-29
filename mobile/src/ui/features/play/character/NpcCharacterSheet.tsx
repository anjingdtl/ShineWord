/**
 * NpcCharacterSheet — the safe public card of an NPC / creature (plan §22).
 *
 * Data comes exclusively from `getNpcPublicProjection()`, which drops every
 * GM-only field (attributes, abilities, prepared slots, resource maxima, hidden
 * skill ids). What is not public is rendered as 「未探明」 rather than hidden
 * outright, so scouting stays a visible part of play.
 */
import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { NpcPublicProjection } from '../../../../../../src/application/campaign/playProjection';
import { getNpcPublicProjection } from '../../../../playProjection';
import { Bar } from '../../../components/Bar';
import { Card } from '../../../components/Card';
import { SectionHeader } from '../../../components/SectionHeader';
import { StatusBanner } from '../../../components/StatusBanner';
import { typeStyle } from '../../../components/typography';
import { useTheme } from '../../../theme/ThemeContext';

const MORALE_LABEL: Record<string, string> = {
  low: '怯战',
  steady: '稳健',
  fierce: '凶悍',
};

const SIDE_LABEL: Record<string, string> = {
  party: '队伍一方',
  hostile: '敌对',
  neutral: '中立',
};

const LIFE_LABEL: Record<string, string> = {
  active: '正常',
  incapacitated: '失能',
  critical: '濒危',
  dead: '已结束',
};

/** At most this many 「？？？」 rows are drawn for hidden skills. */
const MAX_UNKNOWN_ROWS = 3;

export function NpcCharacterSheet(props: {
  campaignId: string;
  branchId: string;
  actorId: string;
  /** Live combat side, when the actor is in an encounter (a visible fact). */
  side?: 'party' | 'hostile' | 'neutral';
}): React.JSX.Element {
  const { theme } = useTheme();
  const [npc, setNpc] = useState<NpcPublicProjection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    // A different actor means the previous card — including a failed read — is
    // stale: reset both, or an old error keeps masking the new actor's card.
    setLoading(true);
    setError(null);
    setNpc(null);
    (async () => {
      try {
        const view = await getNpcPublicProjection(props.campaignId, props.branchId, props.actorId);
        if (cancelled) return;
        setNpc(view);
        setLoading(false);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : String(e));
          setLoading(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [props.campaignId, props.branchId, props.actorId]);

  if (loading) {
    return (
      <Card>
        <Text style={[typeStyle(theme, theme.type.small), { color: theme.onRaised.secondary }]}>
          正在读取公开资料…
        </Text>
      </Card>
    );
  }
  if (error || !npc) {
    return (
      <StatusBanner
        tone="warning"
        title="无法读取公开资料"
        message={error ?? '这个角色没有可展示的公开记录。'}
      />
    );
  }

  const relationship = npc.relationship;
  const otherCloseness = relationship ? Math.max(0, Math.min(100, relationship.closeness)) : 0;

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
              borderColor: theme.accent.secondary,
              backgroundColor: theme.bg.overlay,
            }}>
            <Text style={[typeStyle(theme, theme.type.title), { color: theme.accentText }]}>
              {npc.name.slice(0, 1)}
            </Text>
          </View>
          <View style={{ flex: 1, gap: theme.space.xs }}>
            <Text style={[typeStyle(theme, theme.type.title), { color: theme.onRaised.primary }]}>
              {npc.name}
            </Text>
            <Text style={[typeStyle(theme, theme.type.caption), { color: theme.onRaised.secondary }]}>
              {npc.kind === 'creature' ? '生物' : 'NPC'}
              {props.side ? ` · ${SIDE_LABEL[props.side] ?? props.side}` : ''}
            </Text>
          </View>
        </View>
      </Card>

      <Card>
        <SectionHeader title="已知印象" />
        {npc.description ? (
          <Text style={[typeStyle(theme, theme.type.body), { color: theme.onRaised.primary }]}>
            {npc.description}
          </Text>
        ) : (
          <UnknownBlock text="还没有可确认的印象" />
        )}
      </Card>

      <Card>
        <SectionHeader title="关系 · 战斗倾向" />
        {relationship ? (
          <View style={{ gap: theme.space.sm }}>
            <View style={[styles.row, { gap: theme.space.sm }]}>
              <Text style={[typeStyle(theme, theme.type.small), { color: theme.onRaised.primary, flex: 1 }]}>
                {relationship.toActorId === props.actorId ? '对方对你' : '你对对方'}
              </Text>
              <Text style={[typeStyle(theme, theme.type.caption), { color: theme.accentText }]}>
                {relationship.stance}
              </Text>
            </View>
            <Bar ratio={otherCloseness / 100} label="亲密" valueText={String(relationship.closeness)} />
          </View>
        ) : (
          <UnknownBlock text="关系未探明" />
        )}
        <View style={{ marginTop: theme.space.sm, gap: theme.space.xs }}>
          <Text style={[typeStyle(theme, theme.type.small), { color: theme.onRaised.primary }]}>
            士气：{npc.morale ? MORALE_LABEL[npc.morale] ?? npc.morale : '未探明'}
            {npc.retreatThreshold !== undefined
              ? ` · 撤退阈值 ${Math.round(npc.retreatThreshold * 100)}%`
              : ''}
          </Text>
          {npc.lifeStatus !== null ? (
            <Text style={[typeStyle(theme, theme.type.small), { color: theme.onRaised.secondary }]}>
              当前状态：{LIFE_LABEL[npc.lifeStatus] ?? npc.lifeStatus}
              {npc.visibleConditions.length > 0 ? ` · ${npc.visibleConditions.join('、')}` : ''}
            </Text>
          ) : null}
        </View>
      </Card>

      <Card>
        <SectionHeader
          title="已观察技能"
          subtitle={
            npc.unknownSkillCount > 0 ? `另有 ${npc.unknownSkillCount} 项未探明` : undefined
          }
        />
        <View style={{ gap: theme.space.xs }}>
          {npc.observedSkills.map(skill => (
            <View key={skill.skillId} style={[styles.row, { gap: theme.space.sm }]}>
              <Text style={[typeStyle(theme, theme.type.small), { color: theme.onRaised.primary, flex: 1 }]}>
                {skill.name}
              </Text>
              <Text style={[typeStyle(theme, theme.type.caption), { color: theme.accentText }]}>
                已观察
              </Text>
            </View>
          ))}
          {Array.from({ length: Math.min(npc.unknownSkillCount, MAX_UNKNOWN_ROWS) }, (_, index) => (
            <View key={`unknown-skill-${index}`} style={[styles.row, { gap: theme.space.sm }]}>
              <Text style={[typeStyle(theme, theme.type.small), { color: theme.onRaised.secondary, flex: 1 }]}>
                ？？？
              </Text>
              <Text style={[typeStyle(theme, theme.type.caption), { color: theme.onRaised.secondary }]}>
                未探明
              </Text>
            </View>
          ))}
          {npc.observedSkills.length === 0 && npc.unknownSkillCount === 0 ? (
            <UnknownBlock text="没有技能记录" />
          ) : null}
        </View>
      </Card>

      <Card>
        <SectionHeader
          title="属性 · 能力 · 装备"
          subtitle="需要侦察或遭遇才能确认"
        />
        <UnknownBlock
          text={
            npc.unknownSections.includes('conditions')
              ? '属性 · 能力 · 装备 · 状态\n未 探 明'
              : '属性 · 能力 · 装备\n未 探 明'
          }
        />
      </Card>
    </View>
  );
}

function UnknownBlock(props: { text: string }): React.JSX.Element {
  const { theme } = useTheme();
  return (
    <View
      style={{
        borderWidth: theme.border.hairline,
        borderStyle: 'dashed',
        borderColor: theme.border.color,
        borderRadius: theme.radius.md,
        paddingVertical: theme.space.lg,
        paddingHorizontal: theme.space.md,
      }}>
      <Text
        style={[
          typeStyle(theme, theme.type.caption),
          { color: theme.onRaised.secondary, textAlign: 'center', letterSpacing: 2 },
        ]}>
        {props.text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'flex-start' },
  row: { flexDirection: 'row', alignItems: 'center' },
});