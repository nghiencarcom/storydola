"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { Activity, CreateProjectInput, StoryProject, UpdateProjectInput, WorkspacePayload } from "./project-types";
import type { StoryPresetId } from "./story-presets";

type ProjectContextValue = {
  projects: StoryProject[];
  activities: Activity[];
  provider: WorkspacePayload["provider"] | null;
  ready: boolean;
  error: string;
  refresh: () => Promise<void>;
  getProject: (slug: string) => StoryProject | undefined;
  createProject: (input: CreateProjectInput, presetScope: StoryPresetId) => Promise<StoryProject>;
  updateProject: (slug: string, patch: UpdateProjectInput) => Promise<StoryProject | undefined>;
  deleteProject: (slug: string) => Promise<void>;
};

const ProjectContext = createContext<ProjectContextValue | null>(null);

async function requestJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<T> {
  const response = await fetch(input, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers || {}) } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.message || `Request failed (${response.status})`);
  return payload as T;
}

export function ProjectProvider({ children }: { children: React.ReactNode }) {
  const [projects, setProjects] = useState<StoryProject[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [provider, setProvider] = useState<WorkspacePayload["provider"] | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const projectsSnapshotRef = useRef("");
  const activitiesSnapshotRef = useRef("");
  const providerSnapshotRef = useRef("");
  const refreshInFlightRef = useRef<Promise<void> | null>(null);
  const refreshAgainRef = useRef(false);

  const refresh = useCallback(async () => {
    if (refreshInFlightRef.current) {
      refreshAgainRef.current = true;
      await refreshInFlightRef.current;
      return;
    }

    const request = (async () => {
      try {
        const payload = await requestJson<WorkspacePayload>("/api/projects", { cache: "no-store" });
        const nextProjects = payload.projects || [];
        const nextActivities = payload.activities || [];
        const nextProvider = payload.provider || null;
        const projectsSnapshot = JSON.stringify(nextProjects);
        const activitiesSnapshot = JSON.stringify(nextActivities);
        const providerSnapshot = JSON.stringify(nextProvider);
        if (projectsSnapshot !== projectsSnapshotRef.current) {
          projectsSnapshotRef.current = projectsSnapshot;
          setProjects(nextProjects);
        }
        if (activitiesSnapshot !== activitiesSnapshotRef.current) {
          activitiesSnapshotRef.current = activitiesSnapshot;
          setActivities(nextActivities);
        }
        if (providerSnapshot !== providerSnapshotRef.current) {
          providerSnapshotRef.current = providerSnapshot;
          setProvider(nextProvider);
        }
        setError("");
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : "Không thể tải dữ liệu workspace.");
      } finally {
        setReady(true);
      }
    })();
    refreshInFlightRef.current = request;
    try {
      await request;
    } finally {
      if (refreshInFlightRef.current === request) refreshInFlightRef.current = null;
      if (refreshAgainRef.current) {
        refreshAgainRef.current = false;
        void refresh();
      }
    }
  }, []);

  useEffect(() => {
    void refresh();
    const poll = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const timer = window.setInterval(poll, 15_000);
    document.addEventListener("visibilitychange", poll);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", poll);
    };
  }, [refresh]);

  const value = useMemo<ProjectContextValue>(() => ({
    projects,
    activities,
    provider,
    ready,
    error,
    refresh,
    getProject: (slug) => projects.find((project) => project.slug === slug),
    createProject: async (input, presetScope) => {
      const payload = await requestJson<{ project: StoryProject }>(`/api/projects/create/${encodeURIComponent(presetScope)}`, { method: "POST", body: JSON.stringify(input) });
      await refresh();
      return payload.project;
    },
    updateProject: async (slug, patch) => {
      const payload = await requestJson<{ project: StoryProject }>(`/api/projects/${encodeURIComponent(slug)}`, { method: "PATCH", body: JSON.stringify(patch) });
      await refresh();
      return payload.project;
    },
    deleteProject: async (slug) => {
      await requestJson<{ ok: true }>(`/api/projects/${encodeURIComponent(slug)}`, { method: "DELETE" });
      await refresh();
    },
  }), [projects, activities, provider, ready, error, refresh]);

  return <ProjectContext.Provider value={value}>{children}</ProjectContext.Provider>;
}

export function useProjects() {
  const value = useContext(ProjectContext);
  if (!value) throw new Error("useProjects must be used inside ProjectProvider");
  return value;
}
