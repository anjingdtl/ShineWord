/**
 * CampaignCard — one campaign with its branch tree (plan §8.2).
 *
 * Only stored fields are shown (title, status, creation date, branch ids and
 * their state versions); the card deliberately adds no new database field.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Card } from '../../components/Card';
import { Chip } from '../../components/Chip';
import { useTheme } from '../../theme/ThemeContext';
import { typeStyle } from '../../components/typography';
import { BranchList, type CampaignBranchView } from './BranchList';

export interface CampaignListItemView {
  campaignId: string;
  title: string;
  worldId: string;
  status: string;
  createdAt: string;
}

/** `campaigns.status` values that exist today, in product language. */
const STATUS_LABEL: Record<string, string> = {
  active: '进行中',
};

export function CampaignCard(props: {
  campaign: CampaignListItemView;
  branches: CampaignBranchView[];
  busy?: boolean;
  onContinue: (branchId: string) => void;
}): React.JSX.Element {
  const { theme } = useTheme();
  const { campaign } = props;
  return (
    <Card>
      <View style={[styles.head, { gap: theme.space.sm }]}>
        <Text style={[typeStyle(theme, theme.type.title), { color: theme.onRaised.primary, flex: 1 }]}>
          {campaign.title}
        </Text>
        <Chip label={STATUS_LABEL[campaign.status] ?? campaign.status} selected />
      </View>
      <Text
        style={[
          typeStyle(theme, theme.type.caption),
          { color: theme.onRaised.secondary, marginTop: theme.space.xs },
        ]}>
        创建于 {campaign.createdAt.slice(0, 10)} · {props.branches.length > 1
          ? `共 ${props.branches.length} 条分支`
          : '单分支'}
      </Text>

      <View style={{ marginTop: theme.space.md }}>
        <BranchList
          campaignId={campaign.campaignId}
          branches={props.branches}
          busy={props.busy}
          onContinue={props.onContinue}
        />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center' },
});