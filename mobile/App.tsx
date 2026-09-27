import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import type { ApiProfile } from '../src/application/llm/types';
import { loadApiProfile, saveApiProfile } from './src/profileStore';
import { KeychainSecretStore } from './src/secureKeyStore';
import { loadHistory, playIntent, type PlayedTurn } from './src/runtime';
import { pickNovelFile } from './src/fileBridge';
import {
  buildWorldOnDevice,
  previewNovel,
  type WorldBuildProgress,
} from './src/worldImport';

interface WorldPreviewInfo {
  fileName: string;
  chapters: number;
  codePoints: number;
  encoding: string;
  sourceSha256: string;
}

interface BuiltWorld extends ReturnType<typeof Object> {
  worldId: string;
  title: string;
  chapterCount: number;
  chunkCount: number;
  entityCount: number;
  factCount: number;
  eventCount: number;
  failedChunks: number;
  rejected: number;
}

export default function App(): React.JSX.Element {
  const [profile, setProfile] = useState<ApiProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [screen, setScreen] = useState<'game' | 'world'>('game');
  const [endpoint, setEndpoint] = useState('');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [intent, setIntent] = useState('');
  const [turns, setTurns] = useState<PlayedTurn[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [worldPreview, setWorldPreview] = useState<WorldPreviewInfo | null>(null);
  const [worldProgress, setWorldProgress] = useState<WorldBuildProgress | null>(null);
  const [builtWorld, setBuiltWorld] = useState<BuiltWorld | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function bootstrap() {
      try {
        const saved = await loadApiProfile();
        if (cancelled) return;
        if (saved) {
          setProfile(saved);
          setEndpoint(saved.endpoint);
          setModel(saved.model);
        }
        const history = await loadHistory();
        if (!cancelled) setTurns(history);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    bootstrap();
    return () => {
      cancelled = true;
    };
  }, []);

  function openSettings() {
    if (profile) {
      setEndpoint(profile.endpoint);
      setModel(profile.model);
    }
    setProfile(null);
  }

  async function importAndBuildWorld() {
    if (busy) return;
    setBusy(true);
    setError(null);
    setBuiltWorld(null);
    try {
      const picked = await pickNovelFile();
      if (!picked) {
        setBusy(false);
        return;
      }
      const preview = await previewNovel(picked.bytes, picked.name.replace(/\.txt$/i, ''));
      setWorldPreview({
        fileName: picked.name,
        chapters: preview.parsed.chapters.length,
        codePoints: preview.parsed.codePointCount,
        encoding: preview.parsed.encoding,
        sourceSha256: preview.parsed.sourceSha256Hex.slice(0, 16),
      });
      if (!profile) throw new Error('请先在设置中配置 LLM API，再构建世界。');
      const summary = await buildWorldOnDevice(
        picked.bytes,
        picked.name.replace(/\.txt$/i, ''),
        profile,
        progress => setWorldProgress(progress),
      );
      setBuiltWorld(summary);
    } catch (e) {
      setWorldProgress({ phase: 'failed', message: e instanceof Error ? e.message : String(e) });
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function saveSettings() {
    setBusy(true);
    setError(null);
    try {
      const saved = await saveApiProfile({ endpoint, model });
      const trimmedKey = apiKey.trim();
      const keyStore = new KeychainSecretStore();
      if (trimmedKey) {
        await keyStore.set(saved.keyRef, trimmedKey);
        setApiKey('');
      } else {
        const existing = await keyStore.get(saved.keyRef);
        if (!existing) throw new Error('请输入 API Key（将只写入系统 Keychain）。');
      }
      setProfile(saved);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function submitIntent() {
    if (!profile || !intent.trim() || busy) return;
    const value = intent.trim();
    setIntent('');
    setBusy(true);
    setError(null);
    try {
      const turn = await playIntent(profile, value);
      setTurns(previous =>
        previous.some(item => item.turnId === turn.turnId)
          ? previous.map(item => (item.turnId === turn.turnId ? turn : item))
          : [...previous, turn],
      );
    } catch (e) {
      setIntent(value);
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.center}>
        <ActivityIndicator />
        <Text style={styles.muted}>正在初始化 ShineWord…</Text>
      </SafeAreaView>
    );
  }

  if (!profile) {
    return (
      <SafeAreaView style={styles.page}>
        <Text style={styles.title}>ShineWord</Text>
        <Text style={styles.subtitle}>M2 · API 与游戏闭环</Text>
        <TextInput
          style={styles.input}
          value={endpoint}
          onChangeText={setEndpoint}
          autoCapitalize="none"
          placeholder="OpenAI-compatible endpoint"
          placeholderTextColor="#6f7b86"
        />
        <TextInput
          style={styles.input}
          value={model}
          onChangeText={setModel}
          autoCapitalize="none"
          placeholder="模型名称"
          placeholderTextColor="#6f7b86"
        />
        <TextInput
          style={styles.input}
          value={apiKey}
          onChangeText={setApiKey}
          autoCapitalize="none"
          secureTextEntry
          placeholder="API Key（仅写入系统 Keychain）"
          placeholderTextColor="#6f7b86"
        />
        <TouchableOpacity
          style={styles.primary}
          onPress={saveSettings}
          disabled={busy}>
          <Text style={styles.primaryText}>{busy ? '保存中…' : '保存并进入游戏'}</Text>
        </TouchableOpacity>
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </SafeAreaView>
    );
  }

  if (screen === 'world' && profile) {
    return (
      <SafeAreaView style={styles.page}>
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>世界书架</Text>
            <Text style={styles.subtitle}>导入 TXT → 事实抽取 → 世界</Text>
          </View>
          <TouchableOpacity onPress={() => setScreen('game')}>
            <Text style={styles.link}>返回游戏</Text>
          </TouchableOpacity>
        </View>

        <TouchableOpacity style={styles.primary} onPress={importAndBuildWorld} disabled={busy}>
          <Text style={styles.primaryText}>{busy ? '处理中…' : '导入小说 TXT 并构建世界'}</Text>
        </TouchableOpacity>

        {worldPreview ? (
          <View style={styles.card}>
            <Text style={styles.turn}>{worldPreview.fileName}</Text>
            <Text style={styles.storyText}>
              {worldPreview.chapters} 章 · {worldPreview.codePoints} 字 · 编码 {worldPreview.encoding}
              {'\n'}SHA-256 {worldPreview.sourceSha256}…
            </Text>
          </View>
        ) : null}

        {worldProgress ? (
          <View style={styles.card}>
            <Text style={styles.turn}>
              {worldProgress.phase === 'importing' && '解析原文…'}
              {worldProgress.phase === 'done' && '世界构建完成'}
              {worldProgress.phase === 'failed' && '构建失败'}
            </Text>
            {worldProgress.message ? (
              <Text style={styles.storyText}>{worldProgress.message}</Text>
            ) : null}
          </View>
        ) : null}

        {builtWorld ? (
          <View style={styles.card}>
            <Text style={styles.turn}>{builtWorld.title}</Text>
            <Text style={styles.storyText}>
              {builtWorld.chapterCount} 章 · {builtWorld.chunkCount} 块{'\n'}
              实体 {builtWorld.entityCount} · 事实 {builtWorld.factCount} · 事件 {builtWorld.eventCount}
              {'\n'}失败块 {builtWorld.failedChunks} · 拒绝提案 {builtWorld.rejected}
            </Text>
          </View>
        ) : null}

        {error ? <Text style={styles.error}>{error}</Text> : null}
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.page}>
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>雨夜旧宅</Text>
          <Text style={styles.subtitle}>{profile.model}</Text>
        </View>
        <View style={{ flexDirection: 'row', gap: 14 }}>
          <TouchableOpacity onPress={() => setScreen('world')}>
            <Text style={styles.link}>世界</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={openSettings}>
            <Text style={styles.link}>设置</Text>
          </TouchableOpacity>
        </View>
      </View>

      <FlatList
        style={styles.story}
        data={turns}
        keyExtractor={item => item.turnId}
        ListEmptyComponent={
          <Text style={styles.muted}>
            你站在雨夜旧宅的院门前。输入行动，Planner 会冻结行动合同，本地规则负责骰点与结算。
          </Text>
        }
        renderItem={({ item }) => (
          <View style={styles.card}>
            <Text style={styles.turn}>{item.turnId} · {item.grade}</Text>
            {item.dice ? <Text style={styles.dice}>{item.dice}</Text> : null}
            <Text style={styles.storyText}>{item.text}</Text>
            {item.resumed ? <Text style={styles.resumed}>已从本地断点恢复</Text> : null}
          </View>
        )}
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}
      <View style={styles.composer}>
        <TextInput
          style={[styles.input, styles.composerInput]}
          value={intent}
          onChangeText={setIntent}
          editable={!busy}
          placeholder="例如：观察门锁，然后尝试悄悄进入"
          placeholderTextColor="#6f7b86"
          multiline
        />
        <TouchableOpacity style={styles.primary} onPress={submitIntent} disabled={busy}>
          <Text style={styles.primaryText}>{busy ? '结算中…' : '行动'}</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#08141f', padding: 18 },
  center: {
    flex: 1,
    backgroundColor: '#08141f',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  title: { color: '#f1f5f9', fontSize: 28, fontWeight: '700' },
  subtitle: { color: '#8ea1b2', fontSize: 13, marginTop: 4, marginBottom: 18 },
  muted: { color: '#8ea1b2', lineHeight: 22 },
  input: {
    borderWidth: 1,
    borderColor: '#263a4d',
    backgroundColor: '#0e2030',
    color: '#f1f5f9',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 10,
    marginBottom: 12,
  },
  primary: {
    backgroundColor: '#d9a441',
    borderRadius: 10,
    paddingHorizontal: 18,
    paddingVertical: 13,
    alignItems: 'center',
  },
  primaryText: { color: '#101820', fontWeight: '700' },
  error: { color: '#ff9b9b', marginTop: 10, lineHeight: 20 },
  link: { color: '#d9a441', fontWeight: '600' },
  story: { flex: 1 },
  card: {
    backgroundColor: '#0e2030',
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
  },
  turn: { color: '#d9a441', fontSize: 12, fontWeight: '700', marginBottom: 6 },
  dice: { color: '#91b6d7', fontSize: 12, marginBottom: 8 },
  storyText: { color: '#e6edf3', fontSize: 16, lineHeight: 25 },
  resumed: { color: '#79c99e', fontSize: 11, marginTop: 8 },
  composer: { paddingTop: 10 },
  composerInput: { minHeight: 62, maxHeight: 120 },
});
