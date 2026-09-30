import { buildProvider, createSession, type CampaignListItem } from './runtime';
import type { ApiProfile } from '../../src/application/llm/types';
import { listProjects, type ProjectStatusProjection } from './projectLibrary';

/** Low-frequency session/campaign/branch refresh; never called by the fast reader. */
export async function refreshLibraryFull(profile: ApiProfile): Promise<ProjectStatusProjection[]> {
  const session = await createSession(profile, await buildProvider(profile));
  const campaigns: CampaignListItem[] = [];
  for (const campaign of await session.listCampaigns()) {
    for (const branch of await session.listBranches(campaign.campaignId)) {
      campaigns.push({ ...campaign, branchId: branch.branchId });
    }
  }
  return listProjects({ campaigns });
}

/** Owns focus, timer cleanup and serialization of both refresh paths. */
export function createLibraryRefreshController(deps: {
  full(): Promise<ProjectStatusProjection[]>;
  fast(projects: readonly ProjectStatusProjection[]): Promise<{
    projects: ProjectStatusProjection[]; needsFullRefresh: boolean;
  }>;
  getProjects(): readonly ProjectStatusProjection[];
  apply(projects: ProjectStatusProjection[]): void;
  onError(error: unknown): void;
  setTimer?: (callback: () => void, ms: number) => ReturnType<typeof setInterval>;
  clearTimer?: (timer: ReturnType<typeof setInterval>) => void;
}) {
  let focused = false;
  let generation = 0;
  let pendingFull = false;
  let inFlight: Promise<void> | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  const clearTimer = () => {
    if (timer !== null) (deps.clearTimer ?? clearInterval)(timer);
    timer = null;
  };
  const syncTimer = () => {
    const dynamic = deps.getProjects().some(project => project.buildSummary.dynamicRuns > 0);
    if (!focused || !dynamic) { clearTimer(); return; }
    if (timer === null) timer = (deps.setTimer ?? setInterval)(() => { void pollFast(); }, 1_500);
  };
  const drainFull = async () => {
    while (focused && pendingFull) {
      pendingFull = false;
      const version = generation;
      const projects = await deps.full();
      if (focused && version === generation) deps.apply(projects);
    }
  };
  const start = (work: () => Promise<void>) => {
    if (inFlight) return inFlight;
    inFlight = (async () => {
      try { await work(); await drainFull(); }
      catch (error) { if (focused) deps.onError(error); }
      finally { inFlight = null; syncTimer(); }
    })();
    return inFlight;
  };
  const refreshFull = () => {
    pendingFull = true;
    if (!focused) return Promise.resolve();
    return start(async () => {});
  };
  const pollFast = () => {
    if (!focused || inFlight) return Promise.resolve();
    return start(async () => {
      const version = generation;
      const result = await deps.fast(deps.getProjects());
      if (!focused || version !== generation) return;
      deps.apply(result.projects);
      if (result.needsFullRefresh) pendingFull = true;
    });
  };
  return {
    focus() { focused = true; generation += 1; return refreshFull(); },
    blur() { focused = false; generation += 1; pendingFull = false; clearTimer(); },
    refreshFull,
    pollFast,
  };
}
