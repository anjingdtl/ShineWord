/**
 * QuickActions — the horizontal contextual-action strip (plan §19.3).
 *
 * Tapping a chip **fills the composer only**; the player can still edit the text
 * or ignore it and type freely. There is no auto-submit path here by design.
 */
import React from 'react';
import { ScrollView, Text, View } from 'react-native';
import { Chip } from '../../components/Chip';
import { typeStyle } from '../../components/typography';
import { useTheme } from '../../theme/ThemeContext';

export function QuickActions(props: {
  actions: string[];
  onPick: (text: string) => void;
  disabled?: boolean;
}): React.JSX.Element | null {
  const { theme } = useTheme();
  if (props.actions.length === 0) return null;
  return (
    <View style={{ gap: theme.space.xs }}>
      <Text style={[typeStyle(theme, theme.type.micro), { color: theme.text.muted }]}>
        情境快捷行动（点击只填入输入框）
      </Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ gap: theme.space.sm, paddingVertical: theme.space.xs }}>
        {props.actions.map(action => (
          <Chip
            key={action}
            label={action}
            onPress={() => props.onPick(action)}
            disabled={props.disabled}
            testID={`quick-action-${action}`}
          />
        ))}
      </ScrollView>
    </View>
  );
}