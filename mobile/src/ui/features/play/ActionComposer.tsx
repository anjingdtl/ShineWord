/**
 * ActionComposer — the always-present action input (plan §19.1/§19.2).
 *
 * Layout: contextual chips → multiline field → 行动 button. Requirements the
 * component honours:
 *   · multiline, 500 character ceiling with a visible counter near the limit;
 *   · the button keeps a ≥ 44dp touch target and shows the busy state;
 *   · a failed submit restores the text (the controller writes it back);
 *   · Enter inserts a newline on mobile; sending is the button's job;
 *   · the composer stays visible under the keyboard: the activity already runs
 *     `adjustResize` (AndroidManifest), and the field is plain RN `TextInput`
 *     inside the themed frame.
 */
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Button } from '../../components/Button';
import { TextField } from '../../components/TextField';
import { typeStyle } from '../../components/typography';
import { useTheme } from '../../theme/ThemeContext';
import { QuickActions } from './QuickActions';

const MAX_LENGTH = 500;

export function ActionComposer(props: {
  value: string;
  onChangeText: (value: string) => void;
  onSubmit: () => void;
  busy: boolean;
  quickActions: string[];
}): React.JSX.Element {
  const { theme } = useTheme();
  const canSend = props.value.trim().length > 0 && !props.busy;

  return (
    <View
      style={[
        styles.root,
        {
          paddingHorizontal: theme.space.lg,
          paddingTop: theme.space.sm,
          paddingBottom: theme.space.sm,
          gap: theme.space.sm,
          backgroundColor: theme.bg.base,
          borderTopWidth: theme.border.hairline,
          borderTopColor: theme.border.color,
        },
      ]}>
      <QuickActions
        actions={props.quickActions}
        disabled={props.busy}
        onPick={text => props.onChangeText(text)}
      />
      <TextField
        value={props.value}
        onChangeText={props.onChangeText}
        multiline
        minLines={2}
        maxLength={MAX_LENGTH}
        disabled={props.busy}
        placeholder="你打算怎么做？"
        hint={
          props.value.length > MAX_LENGTH - 80
            ? `还可输入 ${MAX_LENGTH - props.value.length} 字`
            : undefined
        }
        testID="play-composer"
      />
      <View style={[styles.actions, { gap: theme.space.md }]}>
        <Text style={[typeStyle(theme, theme.type.micro), { color: theme.text.muted, flex: 1 }]}>
          {props.busy ? '正在结算这一回合…' : '行动会先经本地规则检定，再交给叙事模型。'}
        </Text>
        <Button
          label={props.busy ? '结算中…' : '行动'}
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