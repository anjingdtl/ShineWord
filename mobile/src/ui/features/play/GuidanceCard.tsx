import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { Button } from '../../components/Button';
import { typeStyle } from '../../components/typography';
import { useTheme } from '../../theme/ThemeContext';
import type { GuidanceStepView, TurnGuidanceV1 } from '../../../../../src/application/guidance/types';

/**
 * P7 guidance card (plan §7.1/§10.1): 这次变化 / 眼下局势 / 下一步路径.
 * Major turning points expand the trade-offs inline; normal turns stay
 * compact. Clicking an available step submits exactly that FIRST step
 * through the normal action pipeline; needs_preparation steps only prefill
 * the composer and show the blockers. Historical guidance renders read-only.
 */
export function GuidanceCard(props: {
  guidance: TurnGuidanceV1;
  /** The version the branch is actually at; stale guidance is read-only. */
  currentStateVersion?: number;
  disabled?: boolean;
  onSubmitStep: (step: GuidanceStepView) => void;
  onPrefillIntent: (intent: string) => void;
}): React.JSX.Element | null {
  const { theme } = useTheme();
  const { guidance } = props;
  const stale = props.currentStateVersion !== undefined
    && guidance.decisionPoint.stateVersion !== props.currentStateVersion;
  const actionable = !stale && !props.disabled;
  const major = guidance.severity === 'major';
  const [expanded, setExpanded] = useState(major);
  if (guidance.steps.length === 0
    && guidance.situationSummary.changes.length === 0
    && guidance.situationSummary.opportunities.length === 0) {
    return null;
  }
  return (
    <View
      testID="guidance-card"
      accessibilityLabel={major ? '重大变化后的下一步引导' : '本回合引导'}
      style={{
        marginHorizontal: theme.space.lg,
        marginTop: theme.space.sm,
        padding: theme.space.md,
        borderRadius: theme.radius.md,
        borderWidth: 1,
        borderColor: major ? theme.border.colorStrong : theme.border.color,
        backgroundColor: theme.bg.raised,
        gap: theme.space.xs,
      }}
    >
      {guidance.situationSummary.changes.length > 0 ? (
        <View testID="guidance-changes">
          <Text style={[typeStyle(theme, theme.type.micro), { color: theme.text.muted }]}>这次变化</Text>
          {guidance.situationSummary.changes.slice(0, 3).map((change: string, index: number) => (
            <Text key={index} style={[typeStyle(theme, theme.type.body), { color: theme.text.primary }]}>· {change}</Text>
          ))}
        </View>
      ) : null}
      {(guidance.situationSummary.opportunities.length > 0 || guidance.situationSummary.pressures.length > 0) ? (
        <View testID="guidance-situation">
          <Text style={[typeStyle(theme, theme.type.micro), { color: theme.text.muted }]}>眼下局势</Text>
          {guidance.situationSummary.opportunities.slice(0, 3).map((text: string, index: number) => (
            <Text key={`o${index}`} style={[typeStyle(theme, theme.type.body), { color: theme.text.primary }]}>· 机会：{text}</Text>
          ))}
          {guidance.situationSummary.pressures.slice(0, 3).map((text: string, index: number) => (
            <Text key={`p${index}`} style={[typeStyle(theme, theme.type.body), { color: theme.text.primary }]}>· 压力：{text}</Text>
          ))}
        </View>
      ) : null}
      {guidance.steps.length > 0 ? (
        <View testID="guidance-steps" style={{ gap: theme.space.sm }}>
          <Text style={[typeStyle(theme, theme.type.micro), { color: theme.text.muted }]}>
            {stale ? '下一步（局面已变化，仅供参考）' : '下一步可以考虑'}
          </Text>
          {guidance.steps.map((step: GuidanceStepView, index: number) => (
            <View
              key={step.candidateRef}
              testID={`guidance-step-${index}`}
              accessibilityLabel={`路径：${step.title}`}
              style={{
                padding: theme.space.sm,
                borderRadius: theme.radius.sm,
                borderWidth: 1,
                borderColor: step.availability === 'available' ? theme.border.color : theme.border.colorStrong,
                gap: theme.space.xs,
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.sm }}>
                <Text style={[typeStyle(theme, theme.type.heading), { color: theme.text.primary, flex: 1 }]}>
                  {step.title}
                </Text>
                {step.availability === 'needs_preparation' ? (
                  <Text style={[typeStyle(theme, theme.type.micro), { color: theme.text.muted }]} testID={`guidance-step-${index}-status`}>需准备</Text>
                ) : null}
                {step.source === 'local' ? (
                  <Text style={[typeStyle(theme, theme.type.micro), { color: theme.text.muted }]}>本地建议</Text>
                ) : null}
              </View>
              <Text style={[typeStyle(theme, theme.type.body), { color: theme.text.secondary }]}>
                {step.firstStepIntent}
              </Text>
              {(expanded || major) && step.rationale ? (
                <Text style={[typeStyle(theme, theme.type.caption), { color: theme.text.secondary }]}>
                  为什么：{step.rationale}
                </Text>
              ) : null}
              {(expanded || major) && step.tradeoffs ? (
                <Text style={[typeStyle(theme, theme.type.caption), { color: theme.text.secondary }]}>
                  取舍：{step.tradeoffs}
                </Text>
              ) : null}
              {step.availability === 'needs_preparation' && (step.blockers ?? []).length > 0 ? (
                <Text style={[typeStyle(theme, theme.type.caption), { color: theme.text.secondary }]} testID={`guidance-step-${index}-blockers`}>
                  准备：{(step.blockers ?? []).join('；')}
                </Text>
              ) : null}
              {actionable ? (
                <View style={{ flexDirection: 'row', gap: theme.space.sm }}>
                  {step.availability === 'available' ? (
                    <Button
                      label="提交这一步"
                      variant="secondary"
                      onPress={() => props.onSubmitStep(step)}
                      testID={`guidance-submit-${index}`}
                      accessibilityLabel={`提交行动：${step.title}`}
                    />
                  ) : (
                    <Button
                      label="填入输入框"
                      variant="chip"
                      onPress={() => props.onPrefillIntent(step.firstStepIntent)}
                      testID={`guidance-prefill-${index}`}
                      accessibilityLabel={`把 ${step.title} 的第一步填入输入框`}
                    />
                  )}
                  {step.availability === 'available' ? (
                    <Button
                      label={expanded ? '收起' : '展开取舍'}
                      variant="chip"
                      onPress={() => setExpanded(value => !value)}
                      testID={`guidance-expand-${index}`}
                      accessibilityLabel={expanded ? '收起取舍说明' : '展开取舍说明'}
                    />
                  ) : null}
                </View>
              ) : null}
            </View>
          ))}
        </View>
      ) : null}
      {guidance.degraded ? (
        <Text style={[typeStyle(theme, theme.type.micro), { color: theme.text.muted }]} testID="guidance-degraded">
          本次路径建议由本地规则生成{stale ? '，且局面已有新变化' : ''}；可自由输入其他行动。
        </Text>
      ) : null}
    </View>
  );
}
