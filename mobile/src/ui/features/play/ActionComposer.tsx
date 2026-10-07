/**
 * ActionComposer — the always-present action input (plan §19.1/§19.2).
 *
 * Layout: contextual chips → multiline field → 行动 button. Requirements the
 * component honours:
 *   · multiline, 500 character ceiling with a visible counter near the limit;
 *   · the button keeps a ≥ 44dp touch target and shows the busy state;
 *   · a failed submit restores the text (the controller writes it back);
 *   · Enter inserts a newline on mobile; sending is the button's job;
 *   · PlayScreen owns keyboard avoidance for the whole layout. The composer
 *     does not apply a second keyboard inset or crowd out the input on small screens.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button } from '../../components/Button';
import { TextField } from '../../components/TextField';
import { typeStyle } from '../../components/typography';
import { useTheme } from '../../theme/ThemeContext';

const MAX_LENGTH = 500;

export function ActionComposer(props: {
  value: string;
  onChangeText: (value: string) => void;
  onSubmit: () => void;
  busy: boolean;
  blocked?: boolean;
  encounterActive?: boolean;
}): React.JSX.Element {
  const { theme } = useTheme();
  const canSend = props.value.trim().length > 0 && !props.busy && !props.blocked;

  return (
    <View
      style={[
        styles.root,
        {
          paddingHorizontal: theme.space.lg,
          paddingTop: theme.space.sm,
          paddingBottom: theme.space.sm,
          gap: theme.space.xs,
          backgroundColor: theme.bg.base,
          borderTopWidth: theme.border.hairline,
          borderTopColor: theme.border.color,
        },
      ]}>
      <TextField
        value={props.value}
        onChangeText={props.onChangeText}
        multiline
        minLines={1}
        maxLength={MAX_LENGTH}
        disabled={props.busy || props.blocked}
        placeholder={props.encounterActive ? '描述你的战斗行动' : '你打算怎么做？'}
        tone="base"
        hint={
          props.value.length > MAX_LENGTH - 80
            ? `还可输入 ${MAX_LENGTH - props.value.length} 字`
            : undefined
        }
        testID="play-composer"
      />
      <View style={[styles.actions, { gap: theme.space.md }]}>
        <Text style={[typeStyle(theme, theme.type.micro), { color: theme.text.muted, flex: 1 }]}>
          {props.busy
            ? '故事正在展开…'
            : props.encounterActive
              ? '写明你的攻击对象，或选择戒备、援救、撤退。'
              : '选择一条路径，或写下你想做的事。'}
        </Text>
        <Button
          label={props.busy ? '进行中…' : '行动'}
          wrapLabel
          onPress={props.onSubmit}
          disabled={!canSend}
          testID="play-submit"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { alignSelf: 'stretch' },
  actions: { flexDirection: 'row', alignItems: 'center' },
});
