/**
 * AboutCard — product identity + author + version (VERSIONING.md) + the
 * compatibility identifiers (plan §3.6).
 *
 * The user-visible brand is Shine-TRPG; the storage identifiers deliberately
 * stay on their historical names so existing installs keep their data.
 */
import React from 'react';
import { Text, View } from 'react-native';
import { Card } from '../../components/Card';
import { SectionHeader } from '../../components/SectionHeader';
import { useTheme } from '../../theme/ThemeContext';
import { typeStyle } from '../../components/typography';
import { PRODUCT_NAME, PRODUCT_AUTHOR, PRODUCT_TAGLINE } from '../../brand';
import versionJson from '../../../version.json';

export function AboutCard(): React.JSX.Element {
  const { theme } = useTheme();
  return (
    <Card>
      <SectionHeader title="关于" subtitle={`${PRODUCT_NAME} · ${PRODUCT_TAGLINE}`} />
      <Text style={[typeStyle(theme, theme.type.small), { color: theme.onRaised.secondary }]}>
        规则、骰点与存档全部在本机运行；云端只用于小说抽取与叙事生成。
      </Text>
      <View style={{ marginTop: theme.space.md, gap: theme.space.xs }}>
        <Text style={[typeStyle(theme, theme.type.caption), { color: theme.onRaised.secondary }]}>
          作者：{PRODUCT_AUTHOR}
        </Text>
        <Text style={[typeStyle(theme, theme.type.caption), { color: theme.onRaised.secondary }]}>
          版本 {versionJson.versionName}（versionCode {versionJson.versionCode}）
        </Text>
        <Text style={[typeStyle(theme, theme.type.caption), { color: theme.onRaised.secondary }]}>
          数据库 `shineword.db` · 存档扩展名 `.shineword-save.json` · 世界包 `.shineword-world.zip`
        </Text>
        <Text style={[typeStyle(theme, theme.type.caption), { color: theme.onRaised.secondary }]}>
          以上内部标识保持不变，以兼容既有安装与旧存档。
        </Text>
      </View>
    </Card>
  );
}
