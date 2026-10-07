/**
 * ImportSaveAction — the 存档导入 entry of the campaign tab (plan §8.1).
 *
 * The copy states exactly what the import does: validate the file and create a
 * new campaign from it. Legacy `.shineword-save.json` files stay importable.
 */
import React from 'react';
import { Text, View } from 'react-native';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { useTheme } from '../../theme/ThemeContext';
import { typeStyle } from '../../components/typography';

export function ImportSaveAction(props: {
  busy: boolean;
  onImport: () => void;
}): React.JSX.Element {
  const { theme } = useTheme();
  return (
    <Card>
      <Text style={[typeStyle(theme, theme.type.heading), { color: theme.onRaised.primary }]}>
        从存档继续
      </Text>
      <Text
        style={[
          typeStyle(theme, theme.type.small),
          { color: theme.onRaised.secondary, marginTop: theme.space.xs },
        ]}>
        导入「.shineword-save.json」会校验完整性并创建为一个新的战役；不支持的旧版存档会明确提示。
      </Text>
      <View style={{ marginTop: theme.space.md }}>
        <Button
          label={props.busy ? '导入中…' : '选择存档文件'}
          variant="secondary"
          onPress={props.onImport}
          disabled={props.busy}
          block
          testID="campaign-import-save"
        />
      </View>
    </Card>
  );
}
