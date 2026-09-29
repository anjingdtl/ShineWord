/**
 * ThemeContext — the single source of design tokens for the whole UI.
 *
 * Two layers of theming (plan §3.1):
 *  1. App-level default skin, persisted under `shineword.ui.theme`.
 *  2. Optional per-world override (`worldId -> ThemeId`), persisted under
 *     `shineword.ui.worldTheme`. P1/P2 only store and resolve it; the UI entry
 *     point for editing per-world skins lands in a later phase, so the mapping
 *     is deliberately write-through but read-only in the screens.
 *
 * No component may read a raw colour: everything goes through `useTheme()`.
 */
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  DEFAULT_THEME_ID,
  THEMES,
  getTheme,
  type ThemeId,
  type ThemeTokens,
} from './tokens';

/** AsyncStorage key for the app-level skin. */
export const THEME_STORAGE_KEY = 'shineword.ui.theme';
/** AsyncStorage key for the per-world skin overrides. */
export const WORLD_THEME_STORAGE_KEY = 'shineword.ui.worldTheme';

export type WorldThemeMap = Record<string, ThemeId>;

export interface ThemeContextValue {
  /** Resolved tokens for the active skin. Never null. */
  theme: ThemeTokens;
  /** Active skin id — inside a world ThemeScope this is the world override. */
  themeId: ThemeId;
  /** App-level skin id, unaffected by world ThemeScopes (e.g. hint labels). */
  globalThemeId: ThemeId;
  /** True once AsyncStorage has been read (the first paint may use the default). */
  hydrated: boolean;
  /** Switch the app-level skin. Persistence is fire-and-forget. */
  setThemeId: (id: ThemeId) => void;
  /** Raw world -> skin overrides, as loaded from storage. */
  worldThemeMap: WorldThemeMap;
  /** Set or clear (null) a world override. */
  setWorldThemeId: (worldId: string, id: ThemeId | null) => void;
  /** Effective skin id for a world: override first, app default second. */
  themeIdForWorld: (worldId?: string | null) => ThemeId;
  /** Effective tokens for a world. */
  themeForWorld: (worldId?: string | null) => ThemeTokens;
}

const FALLBACK_VALUE: ThemeContextValue = {
  theme: THEMES[DEFAULT_THEME_ID],
  themeId: DEFAULT_THEME_ID,
  globalThemeId: DEFAULT_THEME_ID,
  hydrated: false,
  setThemeId: () => undefined,
  worldThemeMap: {},
  setWorldThemeId: () => undefined,
  themeIdForWorld: () => DEFAULT_THEME_ID,
  themeForWorld: () => THEMES[DEFAULT_THEME_ID],
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function parseThemeId(value: string | null | undefined): ThemeId | null {
  if (!value) return null;
  return Object.prototype.hasOwnProperty.call(THEMES, value) ? (value as ThemeId) : null;
}

function parseWorldThemeMap(raw: string | null | undefined): WorldThemeMap {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    const map: WorldThemeMap = {};
    for (const [worldId, value] of Object.entries(parsed as Record<string, unknown>)) {
      const id = typeof value === 'string' ? parseThemeId(value) : null;
      if (id) map[worldId] = id;
    }
    return map;
  } catch {
    // A corrupted preference must never take the app down; fall back to none.
    return {};
  }
}

export function ThemeProvider(props: {
  children: React.ReactNode;
  /** Test/Storybook hook: skip storage hydration and start on this skin. */
  initialThemeId?: ThemeId;
}): React.JSX.Element {
  const [themeId, setThemeIdState] = useState<ThemeId>(props.initialThemeId ?? DEFAULT_THEME_ID);
  const [worldThemeMap, setWorldThemeMap] = useState<WorldThemeMap>({});
  const [hydrated, setHydrated] = useState(props.initialThemeId !== undefined);
  // Guards: never write the default back over stored values before hydration.
  const hydratedRef = useRef(props.initialThemeId !== undefined);

  useEffect(() => {
    if (props.initialThemeId !== undefined) return;
    let cancelled = false;
    (async () => {
      try {
        const [storedTheme, storedWorldMap] = await Promise.all([
          AsyncStorage.getItem(THEME_STORAGE_KEY),
          AsyncStorage.getItem(WORLD_THEME_STORAGE_KEY),
        ]);
        if (cancelled) return;
        const stored = parseThemeId(storedTheme ?? undefined);
        if (stored) setThemeIdState(stored);
        setWorldThemeMap(parseWorldThemeMap(storedWorldMap ?? undefined));
      } catch {
        // Preferences are best-effort: a read failure keeps the default skin.
      } finally {
        if (!cancelled) {
          hydratedRef.current = true;
          setHydrated(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [props.initialThemeId]);

  const setThemeId = useCallback((id: ThemeId) => {
    setThemeIdState(id);
    if (!hydratedRef.current) return;
    void AsyncStorage.setItem(THEME_STORAGE_KEY, id).catch(() => undefined);
  }, []);

  const setWorldThemeId = useCallback((worldId: string, id: ThemeId | null) => {
    setWorldThemeMap(previous => {
      const next: WorldThemeMap = { ...previous };
      if (id) next[worldId] = id;
      else delete next[worldId];
      if (hydratedRef.current) {
        void AsyncStorage.setItem(WORLD_THEME_STORAGE_KEY, JSON.stringify(next)).catch(() => undefined);
      }
      return next;
    });
  }, []);

  const value = useMemo<ThemeContextValue>(() => {
    const themeIdForWorld = (worldId?: string | null): ThemeId =>
      (worldId ? worldThemeMap[worldId] : undefined) ?? themeId;
    return {
      theme: getTheme(themeId),
      themeId,
      globalThemeId: themeId,
      hydrated,
      setThemeId,
      worldThemeMap,
      setWorldThemeId,
      themeIdForWorld,
      themeForWorld: (worldId?: string | null) => getTheme(themeIdForWorld(worldId)),
    };
  }, [themeId, worldThemeMap, hydrated, setThemeId, setWorldThemeId]);

  return <ThemeContext.Provider value={value}>{props.children}</ThemeContext.Provider>;
}

/**
 * Reads the active theme bundle. Outside a `ThemeProvider` the shipped default
 * skin is returned instead of throwing, so a mis-mounted subtree degrades to
 * "wrong colours" rather than a blank screen.
 */
export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (value) return value;
  if (__DEV__) {
    console.warn('[ui] useTheme() outside ThemeProvider — falling back to the default skin.');
  }
  return FALLBACK_VALUE;
}

/**
 * ThemeScope — pins a subtree to one skin without touching the app-level
 * preference (plan §10.1: a world's own skin must actually take effect).
 *
 * Everything except `theme` / `themeId` is inherited, so preferences, storage
 * and the world map keep working inside the scope; the scope is a rendering
 * override only and never writes the app skin.
 */
export function ThemeScope(props: { themeId: ThemeId; children: React.ReactNode }): React.JSX.Element {
  const parent = useTheme();
  const value = useMemo<ThemeContextValue>(
    () => ({ ...parent, theme: getTheme(props.themeId), themeId: props.themeId }),
    [parent, props.themeId],
  );
  return <ThemeContext.Provider value={value}>{props.children}</ThemeContext.Provider>;
}

/**
 * Memoised StyleSheet factory. `factory` must be defined at module scope so it
 * keeps a stable identity across renders; it is then re-run only when the skin
 * actually changes.
 */
export function useThemedStyles<T>(factory: (theme: ThemeTokens) => T): T {
  const { theme } = useTheme();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => factory(theme), [theme, factory]);
}
