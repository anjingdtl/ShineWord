/**
 * NarrativeFeed — the reading surface of the play screen (plan §18.3).
 *
 * Scroll behaviour:
 *   · a newly committed turn scrolls to the end **only if the reader is already
 *     near the bottom** — reading older passages is never interrupted;
 *   · a busy submit never clears the list (the controller keeps history);
 *   · `resumed` turns carry a light marker inside their card.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, StyleSheet, Text, View, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { EmptyState } from '../../components/EmptyState';
import { typeStyle } from '../../components/typography';
import { BackgroundPattern } from '../../theme/ornaments/BackgroundPattern';
import { useTheme } from '../../theme/ThemeContext';
import { TurnCard } from './TurnCard';
import type { TurnView } from '../../../runtime';

/** Distance from the bottom (dp) that still counts as "reading the latest". */
const NEAR_BOTTOM = 48;

export function NarrativeFeed(props: {
  turns: TurnView[];
  goal: string;
  /** True while a turn is being settled; shown without clearing the list. */
  busy: boolean;
}): React.JSX.Element {
  const { theme } = useTheme();
  const listRef = useRef<FlatList<TurnView>>(null);
  const [nearBottom, setNearBottom] = useState(true);

  const onScroll = useCallback((event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const distance = contentSize.height - (contentOffset.y + layoutMeasurement.height);
    setNearBottom(distance <= NEAR_BOTTOM);
  }, []);

  useEffect(() => {
    if (props.turns.length === 0 || !nearBottom) return;
    // Defer one frame so the new row is measured before scrolling.
    const timer = setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 0);
    return () => clearTimeout(timer);
  }, [props.turns.length, nearBottom]);

  return (
    <View style={styles.list}>
      {/* The active skin's texture (竹简竖线 / 网点纸 / 六边形网格) sits behind
          the story; skins without one render nothing (plan §26). */}
      <BackgroundPattern style={styles.pattern} />
      <FlatList
        ref={listRef}
        style={styles.list}
        data={props.turns}
        keyExtractor={item => item.turnId}
        onScroll={onScroll}
        scrollEventThrottle={64}
        contentContainerStyle={{ padding: theme.space.lg, gap: theme.space.md }}
        ListEmptyComponent={
          <EmptyState
            title="故事还没开始"
            description={
              props.goal
                ? `主目标：${props.goal}\n写下你的第一个行动，检定由角色卡与本地规则完成。`
                : '写下你的第一个行动，检定由角色卡与本地规则完成。'
            }
          />
        }
        renderItem={({ item }) => <TurnCard turn={item} />}
        ListFooterComponent={
          props.busy ? (
            <View style={{ paddingVertical: theme.space.sm }}>
              <Text
                style={[
                  typeStyle(theme, theme.type.caption),
                  { color: theme.text.muted, textAlign: 'center' },
                ]}>
                正在结算这一回合…
              </Text>
            </View>
          ) : null
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  list: { flex: 1 },
  pattern: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
});
