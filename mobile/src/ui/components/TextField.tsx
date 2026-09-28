/**
 * TextField — the single themed text input.
 *
 * States: normal / focus / disabled / error, plus secure and multiline. State
 * is carried by the border and the helper line, and the error line also gets a
 * glyph so it never relies on colour alone (plan §30).
 */
import React, { useState } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { Eye, EyeOff } from 'lucide-react-native';
import { useTheme } from '../theme/ThemeContext';
import { typeStyle } from './typography';

export interface TextFieldProps {
  label?: string;
  value: string;
  onChangeText?: (text: string) => void;
  placeholder?: string;
  multiline?: boolean;
  /** Visible lines reserved for a multiline field. */
  minLines?: number;
  secureTextEntry?: boolean;
  disabled?: boolean;
  /** Error message; also switches the field into its error state. */
  error?: string | null;
  /** Helper line below the field (hidden while an error is shown). */
  hint?: string;
  autoFocus?: boolean;
  /** Numeric / code columns use the skin's numeric font. */
  monospace?: boolean;
  keyboardType?: TextInputProps['keyboardType'];
  autoCapitalize?: TextInputProps['autoCapitalize'];
  autoCorrect?: boolean;
  returnKeyType?: TextInputProps['returnKeyType'];
  onSubmitEditing?: () => void;
  /** RN 0.85 keyboard action; defaults to blur-and-submit (single line). */
  submitBehavior?: TextInputProps['submitBehavior'];
  maxLength?: number;
  style?: StyleProp<ViewStyle>;
  inputStyle?: StyleProp<TextStyle>;
  testID?: string;
  accessibilityLabel?: string;
}

export function TextField(props: TextFieldProps): React.JSX.Element {
  const { theme } = useTheme();
  const [focused, setFocused] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const disabled = props.disabled ?? false;
  const hasError = Boolean(props.error);
  const multiline = props.multiline ?? false;

  const borderColor = hasError
    ? theme.semantic.bad
    : focused
      ? theme.accent.primary
      : theme.border.color;

  const fontFamily = props.monospace ? theme.font.numeric : theme.font.ui;
  const lines = props.minLines ?? 3;
  const minHeight = multiline
    ? theme.type.body.lineHeight * lines + theme.space.md * 2
    : theme.touch.min;

  return (
    <View style={[styles.root, { gap: theme.space.xs }, props.style]}>
      {props.label ? (
        <Text style={[typeStyle(theme, theme.type.label), { color: theme.text.secondary }]}>
          {props.label}
        </Text>
      ) : null}
      <View
        style={[
          styles.inputRow,
          {
            backgroundColor: theme.bg.overlay,
            borderColor,
            borderWidth: focused || hasError ? theme.border.hairline + 1 : theme.border.hairline,
            borderRadius: theme.radius.md,
            paddingHorizontal: theme.space.md,
            paddingVertical: theme.space.sm,
            minHeight,
            opacity: disabled ? 0.5 : 1,
          },
        ]}>
        <TextInput
          value={props.value}
          onChangeText={props.onChangeText}
          placeholder={props.placeholder}
          placeholderTextColor={theme.text.muted}
          multiline={multiline}
          secureTextEntry={props.secureTextEntry === true && !revealed}
          editable={!disabled}
          autoFocus={props.autoFocus}
          keyboardType={props.keyboardType}
          autoCapitalize={props.autoCapitalize}
          autoCorrect={props.autoCorrect}
          returnKeyType={props.returnKeyType}
          onSubmitEditing={props.onSubmitEditing}
          submitBehavior={props.submitBehavior ?? (multiline ? 'newline' : 'blurAndSubmit')}
          maxLength={props.maxLength}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          testID={props.testID}
          accessibilityLabel={props.accessibilityLabel ?? props.label}
          style={[
            typeStyle(theme, theme.type.body),
            {
              color: disabled ? theme.text.muted : theme.onRaised.primary,
              fontFamily,
              flex: 1,
              minHeight: multiline ? minHeight - theme.space.md * 2 : undefined,
              padding: 0,
              textAlignVertical: multiline ? 'top' : 'center',
            },
            props.inputStyle,
          ]}
        />
        {props.secureTextEntry ? (
          <Pressable
            onPress={() => setRevealed(value => !value)}
            accessibilityRole="button"
            accessibilityLabel={revealed ? '隐藏输入内容' : '显示输入内容'}
            hitSlop={{ top: theme.space.sm, bottom: theme.space.sm, left: theme.space.sm, right: theme.space.sm }}
            style={styles.toggle}>
            {revealed
              ? <EyeOff size={18} color={theme.text.secondary} />
              : <Eye size={18} color={theme.text.secondary} />}
          </Pressable>
        ) : null}
      </View>
      {hasError ? (
        <Text style={[typeStyle(theme, theme.type.caption), { color: theme.semantic.bad }]}>
          {'⚠ '}{props.error}
        </Text>
      ) : props.hint ? (
        <Text style={[typeStyle(theme, theme.type.caption), { color: theme.text.muted }]}>
          {props.hint}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { alignSelf: 'stretch' },
  inputRow: { flexDirection: 'row', alignItems: 'center' },
  toggle: { paddingLeft: 0 },
});