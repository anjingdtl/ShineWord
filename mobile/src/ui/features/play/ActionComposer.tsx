/**
 * ActionComposer — the always-present action input (plan §19.1/§19.2).
 *
 * Layout: contextual chips → multiline field → 行动 button. Requirements the
 * component honours:
 *   · multiline, 500 character ceiling with a visible counter near the limit;
 *   · the button keeps a ≥ 44dp touch target and shows the busy state;
 *   · a failed submit restores the text (the controller writes it back);
 *   · Enter inserts a newline on mobile; sending is the button's job;
 *   · the composer stays visible above the keyboard: on Android 15+ the
 *     system enforces edge-to-edge (EDGE_TO_EDGE_ENFORCED - the theme
 *     opt-out is ignored on newer APIs), so adjustResize never shrinks the
 *     window and we lift the composer by the measured keyboard height
 *     ourselves.
 */
import React, { useEffect, useState } from 'react';
import { Keyboard, StyleSheet, Text, View } from 'react-native';
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
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const canSend = props.value.trim().length > 0 && !props.busy && !props.blocked;

  useEffect(() => {
    const shown = Keyboard.addListener('keyboardDidShow', event => {
      setKeyboardHeight(Math.max(0, event.endCoordinates.height));
    });
    const hidden = Keyboard.addListener('keyboardDidHide', () => setKeyboardHeight(0));
    return () => { shown.remove(); hidden.remove(); };
  }, []);

  return (
    <View
      style={[
        styles.root,
        {
          paddingHorizontal: theme.space.lg,
          paddingTop: theme.space.sm,
          paddingBottom: keyboardHeight > 0 ? keyboardHeight : theme.space.sm,
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
            ? '正在结算这一回合…'
            : props.encounterActive
              ? '战斗文字只识别明确目标、戒备或撤退；未选目标时会先请你澄清。'
              : '行动由本地规则检定，再交给叙事模型。'}
        </Text>
        <Button
          label={props.busy ? '结算中…' : '行动'}
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
