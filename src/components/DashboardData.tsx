import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { ApiError, apiClient } from "../api/client";
import type {
  HostedRunRecord,
  RepositoryRegistration,
  ReviewerIdentity,
  RunReview,
} from "../control-plane/types";

function apiError(cause: unknown): ApiError {
  return cause instanceof ApiError
    ? cause
    : new ApiError(
        cause instanceof Error ? cause.message : "Dashboard unavailable.",
        0,
        "unavailable",
        "unknown",
        true,
      );
}

interface DashboardState {
  repositories: RepositoryRegistration[];
  repository?: RepositoryRegistration;
  runs: HostedRunRecord[];
  review?: RunReview;
  reviewer?: ReviewerIdentity;
  csrfToken: string;
  loading: boolean;
  refreshing: boolean;
  stale: boolean;
  error?: ApiError;
  reviewError?: ApiError;
  selectRepository(repository: string): void;
  selectRun(runId: string): void;
  retry(): void;
  updateRun(run: HostedRunRecord): void;
}

const DashboardContext = createContext<DashboardState | undefined>(undefined);

export function DashboardDataProvider({ children }: { children: ReactNode }) {
  const [repositories, setRepositories] = useState<RepositoryRegistration[]>([]);
  const [runs, setRuns] = useState<HostedRunRecord[]>([]);
  const [repositoryName, setRepositoryName] = useState("");
  const [runId, setRunId] = useState("");
  const [review, setReview] = useState<RunReview>();
  const [reviewer, setReviewer] = useState<ReviewerIdentity>();
  const [csrfToken, setCsrfToken] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [stale, setStale] = useState(false);
  const [error, setError] = useState<ApiError>();
  const [reviewError, setReviewError] = useState<ApiError>();
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let active = true;
    async function load() {
      setRefreshing(true);
      try {
        const [repositoryPayload, runPayload, session] = await Promise.all([
          apiClient.get<{ repositories: RepositoryRegistration[] }>("/api/repositories"),
          apiClient.get<{ runs: HostedRunRecord[] }>("/api/runs"),
          apiClient.get<{
            authenticated: boolean;
            identity?: ReviewerIdentity;
            csrfToken?: string;
          }>("/api/auth/session"),
        ]);
        if (!active) return;
        setRepositories(repositoryPayload.repositories);
        setRuns(runPayload.runs);
        setReviewer(session.identity);
        setCsrfToken(session.csrfToken ?? "");
        setRepositoryName((current) =>
          repositoryPayload.repositories.some(({ repository }) => repository === current)
            ? current
            : (repositoryPayload.repositories[0]?.repository ?? ""),
        );
        setError(undefined);
        setStale(false);
      } catch (cause) {
        if (!active) return;
        setError(apiError(cause));
        setStale(true);
      } finally {
        if (active) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    }
    void load();
    const timer = setInterval(() => void load(), 15_000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [retryKey]);

  const repositoryRuns = useMemo(
    () => runs.filter((run) => !repositoryName || run.repository === repositoryName),
    [repositoryName, runs],
  );
  const selectedRun =
    repositoryRuns.find(({ id }) => id === runId) ??
    repositoryRuns.find(({ repairId }) => Boolean(repairId));

  useEffect(() => {
    if (!selectedRun?.repairId) {
      return;
    }
    let active = true;
    void apiClient
      .get<{ review: RunReview }>(
        "/api/runs/" + encodeURIComponent(selectedRun.id) + "/review",
      )
      .then(({ review: loaded }) => {
        if (active) {
          setReview(loaded);
          setReviewError(undefined);
        }
      })
      .catch((cause) => {
        if (active) {
          setReview(undefined);
          setReviewError(apiError(cause));
        }
      });
    return () => {
      active = false;
    };
  }, [selectedRun?.id, selectedRun?.repairId, selectedRun?.updatedAt, retryKey]);

  const currentReview = review?.run.id === selectedRun?.id ? review : undefined;
  const currentReviewError = selectedRun?.repairId ? reviewError : undefined;
  const value = useMemo<DashboardState>(
    () => ({
      repositories,
      repository: repositories.find(({ repository }) => repository === repositoryName),
      runs: repositoryRuns,
      review: currentReview,
      reviewer,
      csrfToken,
      loading,
      refreshing,
      stale,
      error,
      reviewError: currentReviewError,
      selectRepository: setRepositoryName,
      selectRun: setRunId,
      retry: () => setRetryKey((key) => key + 1),
      updateRun: (updated) => {
        setRuns((current) => current.map((run) => (run.id === updated.id ? updated : run)));
        setReview((current) => current?.run.id === updated.id ? { ...current, run: updated } : current);
      },
    }),
    [
      repositories, repositoryName, repositoryRuns, currentReview, reviewer, csrfToken,
      loading, refreshing, stale, error, currentReviewError,
    ],
  );

  return <DashboardContext value={value}>{children}</DashboardContext>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useDashboardData(): DashboardState {
  const value = useContext(DashboardContext);
  if (!value) throw new Error("DashboardDataProvider is required.");
  return value;
}
