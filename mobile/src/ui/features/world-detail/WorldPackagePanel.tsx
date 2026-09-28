/**
 * WorldPackagePanel — 世界详情 · 世界包 (plan §10.4).
 *
 * Deliberately light: the published revision, its content hash and the export
 * action, with the standing note that a package never contains the novel text.
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { SectionHeader } from '../../components/SectionHeader';
import { StatusBanner } from '../../components/StatusBanner';
import { typeStyle } from '../../components/typography';
import { useTheme } from '../../theme/ThemeContext';
import { getDatabaseRuntime } from '../../../database';
import { exportWorldPackageZip } from './worldPackageExport';

interface PackageSummary {
  revision: number;
  contentHash: string;
  rulesetVersion: string;
  status: string;
}

export function WorldPackagePanel(props: { worldId: string }): React.JSX.Element {
  const { theme } = useTheme();
  const [summary, setSummary] = useState<PackageSummary | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const runtime = await getDatabaseRuntime();
      const revision = await runtime.worldStore.getPublishedPackageRevision(props.worldId);
      if (revision === null) {
        setSummary(null);
        return;
      }
      const pkg = await runtime.worldStore.getWorldPackage(props.worldId, revision);
      if (!pkg) {
        setSummary(null);
        return;
      }
      setSummary({
        revision,
        contentHash: pkg.manifest.contentHash,
        rulesetVersion: pkg.manifest.ruleset.version,
        status: pkg.manifest.status,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [props.worldId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function exportPackage() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      setNotice(await exportWorldPackageZip(props.worldId));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ gap: theme.space.md }}>
      <Card>
        <SectionHeader
          title="世界包管理"
          subtitle={summary ? `当前版本 r${summary.revision} · ${summary.status}` : '尚未发布世界包'}
        />
        <Text style={[typeStyle(theme, theme.type.small), { color: theme.onRaised.secondary }]}>
          导出的是已发布的三宝书与规则（不可变版本），不含小说原文。收到该 ZIP 的设备可直接导入并创建独立世界。
        </Text>
        {summary ? (
          <Text
            style={[
              typeStyle(theme, theme.type.caption),
              { color: theme.onRaised.primary, marginTop: theme.space.sm, fontFamily: theme.font.numeric },
            ]}>
            content {summary.contentHash.slice(0, 16)}… · 规则 {summary.rulesetVersion}
          </Text>
        ) : null}
        <View style={{ marginTop: theme.space.lg }}>
          <Button
            label={busy ? '导出中…' : '导出世界包 ZIP'}
            onPress={exportPackage}
            disabled={busy || summary === null}
            block
            testID="world-export-package"
          />
        </View>
      </Card>

      {notice ? <StatusBanner tone="success" message={notice} /> : null}
      {error ? <StatusBanner tone="error" title="导出未完成" message={error} /> : null}
    </View>
  );
}