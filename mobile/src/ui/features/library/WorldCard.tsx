/**
 * WorldCard — one row of 「我的世界」 (plan §7.2).
 *
 * Shows the real publication state (published revision, or the builder's own
 * status while unfinished) and routes to the two intents that matter: read the
 * world, or start/continue playing it. A review chip appears only when the
 * mapping pass actually recorded open review issues.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { useTheme } from '../../theme/ThemeContext';
import { typeStyle } from '../../components/typography';
import type { WorldLibraryEntry } from '../../../worldImport';
import { worldStatusLine } from '../worldStatus';

export function WorldCard(props: {
  world: WorldLibraryEntry;
  /** Existing campaign for this world, if any (a branch is always playable). */
  campaign: { campaignId: string; branchId: string } | null;
  busy?: boolean;
  onOpenDetail: () => void;
  onPrimary: () => void;
  onOpenReview: () => void;
}): React.JSX.Element {
  const { theme } = useTheme();
  const { world, campaign } = props;
  const published = world.packageRevision >= 1;

  return (
    <Card>
      <Text style={[typeStyle(theme, theme.type.title), { color: theme.onRaised.primary }]}>
        {world.title}
      </Text>
      <View style={[styles.meta, { gap: theme.space.sm, marginTop: theme.space.xs }]}>
        <Text style={[typeStyle(theme, theme.type.caption), { color: theme.accentText }]}>
          {worldStatusLine(world)}
        </Text>
        <Text style={[typeStyle(theme, theme.type.caption), { color: theme.onRaised.secondary }]}>
          更新于 {world.updatedAt.slice(0, 10)}
        </Text>
      </View>
      <Text
        style={[
          typeStyle(theme, theme.type.small),
          { color: theme.onRaised.secondary, marginTop: theme.space.xs },
        ]}>
        {published ? '世界已经可以开始冒险' : '再次导入同一文件可继续构建三宝书'}
      </Text>

      <View style={[styles.actions, { gap: theme.space.sm, marginTop: theme.space.md }]}>
        <Button
          label={campaign ? '继续冒险' : '开始冒险'}
          variant="primary"
          onPress={props.onPrimary}
          disabled={props.busy === true || !published}
          testID={`world-primary-${world.worldId}`}
        />
        <Button
          label="世界详情"
          variant="secondary"
          onPress={props.onOpenDetail}
          testID={`world-detail-${world.worldId}`}
        />
        {world.openReviewIssues > 0 ? (
          <Button
            label={`待审核 ${world.openReviewIssues}`}
            variant="chip"
            hot
            onPress={props.onOpenReview}
          />
        ) : null}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  meta: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  actions: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
});