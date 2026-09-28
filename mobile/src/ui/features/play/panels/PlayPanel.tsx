/**
 * PlayPanel — the modal sheet every play panel mounts in (plan §20.2).
 *
 * Built on React Native `Modal` + `Animated` only (no Reanimated, no sheet
 * dependency): the sheet slides up while the backdrop fades in. Android Back is
 * routed to `onClose` by the Modal itself, so closing the sheet always takes
 * priority over leaving the screen (plan §30).
 */
import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { typeStyle } from '../../components/typography';
import { useTheme } from '../../theme/ThemeContext';

export function PlayPanel(props: {
  visible: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  /** Optional tab strip rendered under the title. */
  tabs?: React.ReactNode;
  children: React.ReactNode;
}): React.JSX.Element {
  const { theme } = useTheme();
  const { height } = useWindowDimensions();
  const progress = useRef(new Animated.Value(0)).current;
  const maxHeight = Math.round(height * 0.82);

  useEffect(() => {
    if (!props.visible) return;
    // Enter animation only: RN unmounts the Modal on close, so an exit tween
    // would never be seen (and no dependency is worth adding for it).
    progress.setValue(0);
    Animated.timing(progress, {
      toValue: 1,
      duration: 220,
      useNativeDriver: true,
    }).start();
  }, [props.visible, progress]);

  return (
    <Modal
      visible={props.visible}
      transparent
      animationType="none"
      onRequestClose={props.onClose}
      statusBarTranslucent>
      <View style={styles.root}>
        <Animated.View
          style={[
            StyleSheet.absoluteFill,
            {
              // Scrim from the skin's deepest surface token — no literal colour
              // outside the token files (plan §27).
              backgroundColor: theme.bg.sunken,
              opacity: progress.interpolate({ inputRange: [0, 1], outputRange: [0, 0.72] }),
            },
          ]}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={props.onClose}
            accessibilityRole="button"
            accessibilityLabel="关闭面板"
          />
        </Animated.View>

        <Animated.View
          accessibilityViewIsModal
          style={[
            styles.sheet,
            {
              maxHeight,
              backgroundColor: theme.bg.raised,
              borderTopLeftRadius: theme.radius.lg,
              borderTopRightRadius: theme.radius.lg,
              borderColor: theme.border.color,
              borderWidth: theme.border.hairline,
              transform: [
                { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [maxHeight, 0] }) },
              ],
            },
          ]}>
          <View
            style={[
              styles.head,
              {
                paddingHorizontal: theme.space.lg,
                paddingTop: theme.space.md,
                paddingBottom: theme.space.sm,
                gap: theme.space.md,
                borderBottomWidth: theme.border.hairline,
                borderBottomColor: theme.border.color,
              },
            ]}>
            <View style={styles.grip}>
              <View
                style={{
                  width: theme.space.xxl,
                  height: theme.space.xs / 2,
                  borderRadius: theme.radius.pill,
                  backgroundColor: theme.border.colorStrong,
                }}
              />
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.space.md }}>
              <View style={{ flex: 1 }}>
                <Text style={[typeStyle(theme, theme.type.title), { color: theme.onRaised.primary }]}>
                  {props.title}
                </Text>
                {props.subtitle ? (
                  <Text
                    style={[typeStyle(theme, theme.type.caption), { color: theme.onRaised.secondary }]}>
                    {props.subtitle}
                  </Text>
                ) : null}
              </View>
              <Pressable
                onPress={props.onClose}
                accessibilityRole="button"
                accessibilityLabel="关闭面板"
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
                <Text style={[typeStyle(theme, theme.type.small), { color: theme.accentText }]}>✕</Text>
              </Pressable>
            </View>
            {props.tabs}
          </View>

          <ScrollView
            style={{ flexGrow: 0 }}
            contentContainerStyle={{
              padding: theme.space.lg,
              gap: theme.space.md,
              paddingBottom: theme.space.xxl,
            }}>
            {props.children}
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  sheet: { alignSelf: 'stretch' },
  head: {},
  grip: { alignItems: 'center' },
});