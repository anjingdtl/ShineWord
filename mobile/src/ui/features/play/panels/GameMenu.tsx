/**
 * GameMenu — the system actions that used to sit on the play surface
 * (plan §25).
 *
 *   · 短休 / 长休
 *   · 回退到上一状态 — explicitly described as *creating a new branch*, so it is
 *     never mistaken for an undo (plan §25.4)
 *   · 导出存档
 *   · 战役信息 (title, branch, versions, goal, world skin)
 *   · 打开游戏信息 (角色 / 队伍 / 任务 / 物品 / 知识)
 *   · 退出到战役列表
 *
 * Training is not here: it lives in the player's character sheet (plan §25.2).
 */
import React from 'react';
import { Text, View } from 'react-native';
import { Button } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { SectionHeader } from '../../../components/SectionHeader';
import { StatusBanner } from '../../../components/StatusBanner';
import { typeStyle } from '../../../components/typography';
import { useTheme } from '../../../theme/ThemeContext';
import { THEMES } from '../../../theme/tokens';
import { PlayPanel } from './PlayPanel';
import type { PlayController } from '../hooks/usePlayController';

export function GameMenu(props: {
  controller: PlayController;
  visible: boolean;
  onClose: () => void;
  onOpenInfo: () => void;
  onExit: () => void;
}): React.JSX.Element {
  const { theme, themeIdForWorld } = useTheme();
  const {
    projection,
    branchId,
    busy,
    notice,
    error,
    rest,
    rewind,
    exportSave,
  } = props.controller;
  const worldTheme = THEMES[themeIdForWorld(projection?.worldId ?? null)];

  return (
    <PlayPanel
      visible={props.visible}
      title="游戏菜单"
      subtitle="系统动作与战役信息"
      onClose={props.onClose}>
      <View style={{ gap: theme.space.md }}>
        <Card>
          <SectionHeader title="休息与存档" subtitle="休息会推进世界时间" />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.space.sm }}>
            <Button
              label="短休"
              variant="secondary"
              onPress={() => rest('short')}
              disabled={busy}
              testID="menu-short-rest"
            />
            <Button
              label="长休"
              variant="secondary"
              onPress={() => rest('long')}
              disabled={busy}
              testID="menu-long-rest"
            />
            <Button
              label={busy ? '处理中…' : '导出存档'}
              variant="secondary"
              onPress={exportSave}
              disabled={busy}
              testID="menu-export-save"
            />
          </View>
        </Card>

        <Card>
          <SectionHeader title="回退" subtitle="创建新分支，不覆盖当前历史" />
          <Text style={[typeStyle(theme, theme.type.small), { color: theme.onRaised.secondary }]}>
            回退会从上一状态版本「新建一条分支」，当前分支与其历史完整保留，可随时切回。
          </Text>
          <View style={{ marginTop: theme.space.md }}>
            <Button
              label={busy ? '回退中…' : `回退到上一状态（v${(projection?.stateVersion ?? 1) - 1}）`}
              variant="secondary"
              onPress={rewind}
              disabled={busy || (projection?.stateVersion ?? 0) <= 0}
              testID="menu-rewind"
            />
          </View>
        </Card>

        <Card>
          <SectionHeader title="战役信息" subtitle={projection?.title ?? '加载中'} />
          <Text style={[typeStyle(theme, theme.type.small), { color: theme.onRaised.primary }]}>
            分支：{branchId}
          </Text>
          <Text style={[typeStyle(theme, theme.type.small), { color: theme.onRaised.primary }]}>
            状态版本：v{projection?.stateVersion ?? '–'} · 世界包：r{projection?.packageRevision ?? '–'}
          </Text>
          <Text style={[typeStyle(theme, theme.type.small), { color: theme.onRaised.primary }]}>
            主题：{worldTheme.label}
          </Text>
          {projection?.goal ? (
            <Text
              style={[
                typeStyle(theme, theme.type.caption),
                { color: theme.onRaised.secondary, marginTop: theme.space.xs },
              ]}>
              主目标：{projection.goal}
            </Text>
          ) : null}
        </Card>

        <Card>
          <SectionHeader title="游戏信息" subtitle="角色 · 队伍 · 任务 · 物品 · 知识" />
          <Button
            label="打开游戏信息面板"
            variant="secondary"
            onPress={props.onOpenInfo}
            block
            testID="menu-open-info"
          />
        </Card>

        {notice ? <StatusBanner tone="success" message={notice} /> : null}
        {error ? <StatusBanner tone="error" title="操作未完成" message={error} /> : null}

        <Button
          label="退出到战役列表"
          variant="secondary"
          onPress={props.onExit}
          block
          testID="menu-exit"
        />
      </View>
    </PlayPanel>
  );
}