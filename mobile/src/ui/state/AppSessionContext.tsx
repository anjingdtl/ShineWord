/**
 * App-level session state shared by every screen.
 *
 * This used to live as `useState` inside App.tsx and was passed down by hand;
 * with a navigator in place the same three values are exposed through a
 * context instead of being threaded through route params. It is UI state only —
 * the persistence and validation still live in the untouched bridge layer
 * (`src/profileStore`, `src/secureKeyStore`).
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ApiProfile } from '../../../../src/application/llm/types';
import { loadApiProfile } from '../../profileStore';
import { getDatabaseRuntime, createFreshDevelopmentDatabase } from '../../database';

export interface AppSessionValue {
  /** Saved API profile, or null before first-run setup. */
  profile: ApiProfile | null;
  /** True while the stored profile is being read. */
  loading: boolean;
  /** Last surfaced error, rendered by the screen that owns the action. */
  error: string | null;
  setError: (value: string | null) => void;
  setProfile: (value: ApiProfile | null) => void;
  databaseError: string | null;
  createFreshDatabase: () => Promise<void>;
}

const AppSessionContext = createContext<AppSessionValue | null>(null);

export function AppSessionProvider(props: { children: React.ReactNode }): React.JSX.Element {
  const [profile, setProfile] = useState<ApiProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [databaseError, setDatabaseError] = useState<string | null>(null);
  const createFreshDatabase = useCallback(async () => {
    setLoading(true);
    try { await createFreshDevelopmentDatabase(); setDatabaseError(null); }
    catch (e) { setDatabaseError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const saved = await loadApiProfile();
        if (!cancelled && saved) setProfile(saved);
        try { await getDatabaseRuntime(); }
        catch (e) { if (!cancelled) setDatabaseError(e instanceof Error ? e.message : String(e)); }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo<AppSessionValue>(
    () => ({ profile, loading, error, setError, setProfile, databaseError, createFreshDatabase }),
    [profile, loading, error, databaseError, createFreshDatabase],
  );

  return <AppSessionContext.Provider value={value}>{props.children}</AppSessionContext.Provider>;
}

export function useAppSession(): AppSessionValue {
  const value = useContext(AppSessionContext);
  if (!value) throw new Error('useAppSession() must be used inside <AppSessionProvider>.');
  return value;
}

/** Convenience for screens that must not render before a profile exists. */
export function useRequireProfile(): ApiProfile {
  const { profile } = useAppSession();
  if (!profile) throw new Error('A saved API profile is required to render this screen.');
  return profile;
}

/** Re-exported so callers can annotate their own helpers without a deep import. */
export type { ApiProfile };
