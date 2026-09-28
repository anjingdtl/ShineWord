/**
 * RollStrip — the inline dice result of one turn (plan §18.2).
 *
 * Everything shown comes from the persisted `RollRecord`: die face, dice count,
 * every rolled value with the kept (highest) one emphasised, the difficulty and
 * margin the engine computed, and the grade named exactly as the rule domain
 * names it (`full_success` / `success` / `failure` / `severe_failure`).
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Polygon } from 'react-native-svg';
import { DieBadge } from '../../components/Bar';
import { typeStyle } from '../../components/typography';
import { useTheme } from '../../theme/ThemeContext';
import type { TurnRollView } from '../../../runtime';

interface GradeStyle {
  label: string;
  glyph: string;
  good: boolean;
}

/** Rule-domain grade names → display. No other vocabulary is invented. */
const GRADES: Record<string, GradeStyle> = {
  full_success: { label: '大成功', glyph: '★', good: true },
  success: { label: '成功', glyph: '◆', good: true },
  failure: { label: '失败', glyph: '▲', good: false },
  severe_failure: { label: '大失败', glyph: '✕', good: false },
};

/** 漫 skin only: the comic "success!" burst on the strip's corner. */
function BurstBadge(props: { text: string }): React.JSX.Element {
  const { theme } = useTheme();
  return (
    <View pointerEvents="none" style={styles.burst}>
      <Svg width={64} height={48} viewBox="0 0 52 40">
        <Polygon
          points="26,0 30,10 40,4 37,14 50,12 40,20 50,28 37,26 40,36 30,30 26,40 22,30 12,36 15,26 2,28 12,20 2,12 15,14 12,4 22,10"
          fill={theme.accent.tertiary}
          stroke={theme.border.color}
          strokeWidth={2}
        />
      </Svg>
      <View style={[StyleSheet.absoluteFill, styles.burstLabel]}>
        <Text style={[typeStyle(theme, theme.type.micro), { color: theme.onRaised.primary }]}>
          {props.text}
        </Text>
      </View>
    </View>
  );
}

export function RollStrip(props: { roll: TurnRollView }): React.JSX.Element {
  const { theme } = useTheme();
  const { roll } = props;
  const grade = GRADES[roll.grade] ?? { label: roll.grade, glyph: '·', good: true };
  const color = grade.good ? theme.semantic.good : theme.semantic.bad;

  return (
    <View
      accessibilityLabel={`检定 ${roll.diceCount}d${roll.dieSides} 取高，掷出 ${roll.rolls.join('、')}，最高 ${roll.highest}，${grade.label}`}
      style={[
        styles.root,
        {
          gap: theme.space.sm,
          paddingVertical: theme.space.sm,
          paddingHorizontal: theme.space.md,
          backgroundColor: theme.bg.overlay,
          borderColor: theme.border.color,
          borderWidth: theme.border.hairline,
          borderRadius: theme.radius.md,
        },
      ]}>
      <DieBadge sides={roll.dieSides} />
      <Text
        style={[
          typeStyle(theme, theme.type.caption),
          { color: theme.onRaised.secondary, fontFamily: theme.font.numeric },
        ]}>
        {roll.diceCount}d{roll.dieSides} 取高
      </Text>
      <View style={[styles.diceRow, { gap: theme.space.xs }]}>
        {roll.rolls.map((value, index) => {
          const kept = value === roll.highest;
          return (
            <View
              key={`${index}-${value}`}
              style={{
                minWidth: theme.space.xl,
                paddingHorizontal: theme.space.xs,
                paddingVertical: 1,
                alignItems: 'center',
                borderRadius: theme.radius.sm,
                borderWidth: theme.border.hairline,
                borderColor: kept ? theme.accent.primary : theme.border.color,
                backgroundColor: kept ? theme.bg.raised : 'transparent',
              }}>
              <Text
                style={[
                  typeStyle(theme, theme.type.small),
                  {
                    color: kept ? theme.accentText : theme.onRaised.secondary,
                    fontFamily: theme.font.numeric,
                    fontWeight: kept ? '700' : '400',
                  },
                ]}>
                {value}
              </Text>
            </View>
          );
        })}
      </View>
      <View style={styles.spacer} />
      <Text
        style={[
          typeStyle(theme, theme.type.caption),
          { color: theme.onRaised.secondary, fontFamily: theme.font.numeric },
        ]}>
        难度 {roll.difficulty} · 余量 {roll.margin >= 0 ? `+${roll.margin}` : roll.margin}
      </Text>
      <Text
        style={[
          typeStyle(theme, theme.type.small),
          { color, fontWeight: '700' },
        ]}>
        {grade.glyph} {grade.label}
      </Text>
      {theme.id === 'manga' && roll.grade === 'full_success' ? <BurstBadge text="大成功!" /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  diceRow: { flexDirection: 'row', alignItems: 'center' },
  spacer: { flex: 1 },
  burst: { position: 'absolute', right: -8, top: -16 },
  burstLabel: { alignItems: 'center', justifyContent: 'center' },
});