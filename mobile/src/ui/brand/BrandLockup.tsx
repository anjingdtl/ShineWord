/**
 * BrandLockup — mark + wordmark + tagline in one block.
 *
 * Used by the bootstrap screen and first-run so the product identity appears
 * exactly the same way in both (plan §3.4/§6.3).
 */
import React from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useTheme } from '../theme/ThemeContext';
import { typeStyle } from '../components/typography';
import { BrandMark } from './BrandMark';
import { BrandWordmark } from './BrandWordmark';
import { PRODUCT_TAGLINE } from './brand';

export function BrandLockup(props: {
  /** `column` = splash/hero; `row` = compact header lockup. */
  layout?: 'row' | 'column';
  markSize?: number;
  wordSize?: 'sm' | 'md' | 'lg';
  showTagline?: boolean;
  style?: StyleProp<ViewStyle>;
}): React.JSX.Element {
  const { theme } = useTheme();
  const layout = props.layout ?? 'column';
  const markSize = props.markSize ?? (layout === 'row' ? 28 : 56);
  return (
    <View
      style={[
        layout === 'row' ? styles.row : styles.column,
        { gap: layout === 'row' ? theme.space.md : theme.space.sm },
        props.style,
      ]}>
      <BrandMark size={markSize} />
      <View style={layout === 'column' ? styles.centered : undefined}>
        <BrandWordmark size={props.wordSize ?? (layout === 'row' ? 'sm' : 'lg')} />
        {props.showTagline ?? layout === 'column' ? (
          <Text
            style={[
              typeStyle(theme, theme.type.caption),
              { color: theme.text.secondary, textAlign: layout === 'column' ? 'center' : 'left' },
            ]}>
            {PRODUCT_TAGLINE}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  column: { alignItems: 'center' },
  centered: { alignItems: 'center' },
});