/**
 * BranchList — the branch tree of one campaign (plan §8.2/§8.3).
 *
 * The main line is listed first and every fork keeps its parent visible, so a
 * rewind-created sibling is never confused with the line it came from. Each
 * row continues into exactly that branch id.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button } from '../../components/Button';
import { useTheme } from '../../theme/ThemeContext';
import { typeStyle } from '../../components/typography';
import { BranchBadge } from './BranchBadge';

export interface CampaignBranchView {
  branchId: string;
  parentBranchId: string | null;
  stateVersion: number;
  createdAt: string;
}

/** The branch `createCampaign` mints for a new campaign. */
export function mainBranchIdOf(campaignId: string): string {
  return `${campaignId}-main`;
}

export function BranchList(props: {
  campaignId: string;
  branches: CampaignBranchView[];
  busy?: boolean;
  onContinue: (branchId: string) => void;
}): React.JSX.Element {
  const { theme } = useTheme();
  const mainId = mainBranchIdOf(props.campaignId);
  // A new campaign always has `${campaignId}-main`; if the stored ids ever
  // differ, the earliest branch is treated as the main line rather than hidden.
  const mainBranch = props.branches.find(branch => branch.branchId === mainId) ?? props.branches[0] ?? null;
  const ordered: Array<{ branch: CampaignBranchView; role: 'main' | 'fork' }> = [
    ...(mainBranch ? [{ branch: mainBranch, role: 'main' as const }] : []),
    ...props.branches
      .filter(branch => branch !== mainBranch)
      .map(branch => ({ branch, role: 'fork' as const })),
  ];

  return (
    <View style={{ gap: theme.space.sm }}>
      {ordered.map(({ branch, role }, index) => {
        const last = index === ordered.length - 1;
        return (
          <View key={branch.branchId} style={[styles.row, { gap: theme.space.sm }]}>
            <Text
              style={[
                typeStyle(theme, theme.type.caption),
                { color: theme.onRaised.secondary, width: theme.space.lg },
              ]}>
              {role === 'main' ? '└─' : last ? '└─' : '├─'}
            </Text>
            <View style={{ flex: 1, gap: theme.space.xs }}>
              <BranchBadge role={role} label={branch.branchId} stateVersion={branch.stateVersion} />
              <Text
                style={[typeStyle(theme, theme.type.caption), { color: theme.onRaised.secondary }]}>
                {role === 'fork' && branch.parentBranchId
                  ? `来自 ${branch.parentBranchId} · `
                  : ''}
                创建于 {branch.createdAt.slice(0, 10)}
              </Text>
            </View>
            <Button
              label={role === 'main' ? '继续冒险' : '继续'}
              variant={role === 'main' ? 'primary' : 'chip'}
              onPress={() => props.onContinue(branch.branchId)}
              disabled={props.busy === true}
              testID={`branch-continue-${branch.branchId}`}
            />
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
});