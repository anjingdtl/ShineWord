/**
 * AvatarContext — the app-level player avatar preference (plan §5).
 *
 * Follows the proven ThemeContext pattern line by line: AsyncStorage
 * hydration with a `hydratedRef` guard so the default never overwrites a
 * stored value, fire-and-forget writes, and defensive normalisation — a read
 * failure or an id that is no longer in the registry degrades to "no avatar"
 * (the default nameplate) instead of ever blocking the app.
 *
 * The avatar is player identity, not world chrome: ThemeScope never touches
 * it, so entering a world with its own skin keeps the chosen avatar.
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
import { findAvatar } from './avatarRegistry';

/** AsyncStorage key for the app-level avatar (same family as shineword.ui.theme). */
export const AVATAR_STORAGE_KEY = 'shineword.ui.avatar.v1';

export interface AvatarContextValue {
  /** Selected preset id, or null when unset (default nameplate). */
  avatarId: string | null;
  /** True once AsyncStorage has been read (the first paint may use null). */
  hydrated: boolean;
  /** Select an avatar; null clears it. Persistence is fire-and-forget. */
  setAvatarId: (id: string | null) => void;
}

const FALLBACK_VALUE: AvatarContextValue = {
  avatarId: null,
  hydrated: false,
  setAvatarId: () => undefined,
};

const AvatarContext = createContext<AvatarContextValue | null>(null);

/** A stored value counts only when it names a preset; anything else is "unset". */
function parseAvatarId(value: string | null | undefined): string | null {
  if (!value) return null;
  return findAvatar(value) ? value : null;
}

export function AvatarProvider(props: { children: React.ReactNode }): React.JSX.Element {
  const [avatarId, setAvatarIdState] = useState<string | null>(null);
  const [hydrated, setHydrated] = useState(false);
  // Guard: never write the unset default back over stored values before hydration.
  const hydratedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const stored = await AsyncStorage.getItem(AVATAR_STORAGE_KEY);
        if (cancelled) return;
        setAvatarIdState(parseAvatarId(stored));
      } catch {
        // Preferences are best-effort: a read failure keeps the default (no avatar).
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
  }, []);

  const setAvatarId = useCallback((id: string | null) => {
    setAvatarIdState(id);
    if (!hydratedRef.current) return;
    const write = id === null
      ? AsyncStorage.removeItem(AVATAR_STORAGE_KEY)
      : AsyncStorage.setItem(AVATAR_STORAGE_KEY, id);
    void write.catch(() => undefined);
  }, []);

  const value = useMemo<AvatarContextValue>(
    () => ({ avatarId, hydrated, setAvatarId }),
    [avatarId, hydrated, setAvatarId],
  );

  return <AvatarContext.Provider value={value}>{props.children}</AvatarContext.Provider>;
}

/**
 * Reads the avatar preference. Outside an `AvatarProvider` the unset default
 * is returned instead of throwing, so a mis-mounted subtree degrades to
 * "nameplate visible" rather than a blank screen.
 */
export function useAvatar(): AvatarContextValue {
  const value = useContext(AvatarContext);
  if (value) return value;
  if (__DEV__) {
    console.warn('[ui] useAvatar() outside AvatarProvider — falling back to "no avatar".');
  }
  return FALLBACK_VALUE;
}
