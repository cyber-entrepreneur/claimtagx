import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { logout as apiLogout } from "./authApi";
import {
  createAsset,
  getAssetByTicket,
  getListAssetsQueryKey,
  getListTamperEventsQueryKey,
  listAssets,
  releaseAsset,
  type CustodyAsset as ApiCustodyAsset,
  type TamperEvent,
} from "@workspace/api-client-react";
import type {
  AssetModeId,
  CustodyAsset,
  HandlerSession,
  VenueMembership,
} from "./types";
import { MODES, VENUE_TYPE_TO_MODE } from "./modes";
import {
  fetchMe,
  joinVenue as apiJoinVenue,
  leaveVenue as apiLeaveVenue,
} from "./api";
import { API_BASE_URL, getApiUrl } from "./api-base";
import { toast } from "@/hooks/use-toast";

const ACTIVE_VENUE_KEY = "ctx_active_venue";

function toLocal(a: ApiCustodyAsset): CustodyAsset {
  return {
    id: a.id,
    ticketId: a.ticketId,
    mode: a.mode as AssetModeId,
    patron: { name: a.patron.name, phone: a.patron.phone },
    fields: (a.fields ?? {}) as Record<string, string | number | boolean>,
    photos: (a.photos ?? []) as string[],
    intakeAt: a.intakeAt,
    handler: a.handler,
    status: a.status as "active" | "released",
    releasedAt: a.releasedAt ?? undefined,
    releasedBy: a.releasedBy ?? null,
    signature: a.signature,
  };
}

interface StoreCtx {
  ready: boolean;
  signedIn: boolean;
  session: HandlerSession | null;
  venues: VenueMembership[];
  activeVenue: VenueMembership | null;
  setActiveVenue: (code: string) => void;
  joinVenue: (inviteToken: string) => Promise<VenueMembership[]>;
  leaveVenue: (code: string) => Promise<VenueMembership[]>;
  refreshMe: () => Promise<void>;
  signOut: () => Promise<void>;
  // Asset mode is derived from the active venue's `venueType`. The owner
  // picks the venue type once in settings and the handler app re-skins
  // intake fields, ticket columns, tile copy, and aging bands automatically
  // — so handlers never see a manual asset-mode toggle.
  mode: AssetModeId;
  effectiveModes: AssetModeId[];
  canAccessMode: (m: AssetModeId) => boolean;
  authorization: {
    stationModes: AssetModeId[];
    handlerModes: AssetModeId[];
    effectiveModes: AssetModeId[];
    hasAnyModeAccess: boolean;
    stationModesSource: "membership" | "derived";
    handlerModesSource: "membership" | "role-derived";
    usingDerivedDefaults: boolean;
  };
  assets: CustodyAsset[];
  loading: boolean;
  intake: (
    a: Omit<CustodyAsset, "id" | "ticketId" | "intakeAt" | "handler" | "status" | "signature">,
  ) => Promise<CustodyAsset>;
  release: (
    ticketId: string,
    opts?: { signature?: string; source?: "scan" | "manual" },
  ) => Promise<CustodyAsset | null>;
  findByTicket: (ticketId: string) => Promise<CustodyAsset | undefined>;
  streamStatus: "idle" | "connecting" | "connected" | "disconnected";
}

const Ctx = createContext<StoreCtx | null>(null);

const ALL_MODE_IDS: AssetModeId[] = MODES.map((m) => m.id);

function isAssetModeId(value: string): value is AssetModeId {
  return (ALL_MODE_IDS as string[]).includes(value);
}

function uniqueModes(modes: AssetModeId[]): AssetModeId[] {
  return [...new Set(modes)];
}

function readStoredVenue(): string | null {
  try {
    return localStorage.getItem(ACTIVE_VENUE_KEY);
  } catch {
    return null;
  }
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();

  const [activeVenueCode, setActiveVenueCodeState] = useState<string | null>(
    () => readStoredVenue(),
  );

  useEffect(() => {
    try {
      if (activeVenueCode) localStorage.setItem(ACTIVE_VENUE_KEY, activeVenueCode);
      else localStorage.removeItem(ACTIVE_VENUE_KEY);
    } catch {}
  }, [activeVenueCode]);

  // Pull membership info from server. /api/me reads identity + memberships
  // from server-authoritative tables using the httpOnly session cookie. A 401
  // means the handler is signed out; anything else is a transient error.
  const meQuery = useQuery({
    queryKey: ["me"],
    queryFn: fetchMe,
    staleTime: 30_000,
    retry: (count, err) =>
      (err as { status?: number } | undefined)?.status !== 401 && count < 2,
  });

  const authLoaded = meQuery.isFetched;
  const isSignedIn = meQuery.isSuccess && Boolean(meQuery.data);

  const venues = meQuery.data?.venues ?? [];
  const email = meQuery.data?.email ?? "";
  const handlerName = meQuery.data?.name || email.split("@")[0] || "Handler";

  // Reconcile active venue with the membership list.
  useEffect(() => {
    if (!isSignedIn) {
      setActiveVenueCodeState(null);
      return;
    }
    if (!meQuery.data) return;
    if (venues.length === 0) {
      setActiveVenueCodeState(null);
      return;
    }
    const matches = activeVenueCode
      ? venues.find((v) => v.code === activeVenueCode)
      : null;
    if (!matches) setActiveVenueCodeState(venues[0].code);
  }, [isSignedIn, meQuery.data, venues, activeVenueCode]);

  const activeVenue = useMemo<VenueMembership | null>(
    () => venues.find((v) => v.code === activeVenueCode) ?? null,
    [venues, activeVenueCode],
  );

  // Dual authorization model:
  // 1) Station capability filter (which asset modes the station supports)
  // 2) Handler authorization filter (which modes this handler can operate)
  // Effective modes are intersection(station ∩ handler).
  const stationModesProvided = Array.isArray(activeVenue?.stationCapabilities);

  const stationModes = useMemo<AssetModeId[]>(() => {
    if (stationModesProvided) {
      const fromMembership = (activeVenue?.stationCapabilities ?? []).filter((m) =>
        isAssetModeId(m),
      );
      return uniqueModes(fromMembership);
    }
    return [VENUE_TYPE_TO_MODE[activeVenue?.venueType ?? "other"]];
  }, [stationModesProvided, activeVenue?.stationCapabilities, activeVenue?.venueType]);

  const stationModesSource: "membership" | "derived" =
    stationModesProvided ? "membership" : "derived";

  const handlerModesProvided = Array.isArray(activeVenue?.handlerAuthorizations);

  const handlerModes = useMemo<AssetModeId[]>(() => {
    if (handlerModesProvided) {
      const fromMembership = (activeVenue?.handlerAuthorizations ?? []).filter((m) =>
        isAssetModeId(m),
      );
      return uniqueModes(fromMembership);
    }
    const role = (activeVenue?.role ?? "handler").toLowerCase();
    if (role === "owner" || role === "supervisor") return ALL_MODE_IDS;
    return stationModes;
  }, [handlerModesProvided, activeVenue?.handlerAuthorizations, activeVenue?.role, stationModes]);

  const handlerModesSource: "membership" | "role-derived" =
    handlerModesProvided ? "membership" : "role-derived";

  const effectiveModes = useMemo<AssetModeId[]>(
    () => stationModes.filter((m) => handlerModes.includes(m)),
    [stationModes, handlerModes],
  );

  // Drive the asset mode straight from the venue's classification. Default
  // to "other" → vehicles when an owner hasn't picked a type yet, so the
  // app stays usable instead of going blank on a fresh tenant.
  const mode: AssetModeId = useMemo(
    () => effectiveModes[0] ?? stationModes[0] ?? "vehicles",
    [effectiveModes, stationModes],
  );

  const canAccessMode = useCallback(
    (m: AssetModeId) => effectiveModes.includes(m),
    [effectiveModes],
  );

  const authorization = useMemo(
    () => ({
      stationModes,
      handlerModes,
      effectiveModes,
      hasAnyModeAccess: effectiveModes.length > 0,
      stationModesSource,
      handlerModesSource,
      usingDerivedDefaults:
        stationModesSource === "derived" || handlerModesSource === "role-derived",
    }),
    [
      stationModes,
      handlerModes,
      effectiveModes,
      stationModesSource,
      handlerModesSource,
    ],
  );

  const session = useMemo<HandlerSession | null>(() => {
    if (!isSignedIn || !activeVenue || !email) return null;
    return {
      email,
      handlerName,
      venueCode: activeVenue.code,
      venueName: activeVenue.name,
    };
  }, [isSignedIn, activeVenue, email, handlerName]);

  const venueCode = activeVenue?.code ?? "";

  const { data: assets = [], isLoading: assetsLoading } = useQuery({
    queryKey: getListAssetsQueryKey(venueCode),
    queryFn: () => listAssets(venueCode).then((rows) => rows.map(toLocal)),
    enabled: Boolean(venueCode),
  });

  const [streamStatus, setStreamStatus] = useState<
    "idle" | "connecting" | "connected" | "disconnected"
  >("idle");

  // Subscribe to a server-sent event stream so a release or intake on one
  // handler device shows up on every other device immediately, instead of
  // waiting for the next React Query refresh. The stream is scoped to the
  // active venue and re-opens when the venue changes.
  useEffect(() => {
    if (!venueCode || !isSignedIn) {
      setStreamStatus("idle");
      return;
    }
    const streamPath = `/api/venues/${encodeURIComponent(venueCode)}/events`;
    const streamUrl = getApiUrl(streamPath);
    // Cross-origin EventSource cannot carry our bearer token header.
    // When a remote API base is configured, rely on query invalidation
    // and optimistic updates instead of a noisy unauthorized SSE loop.
    if (API_BASE_URL) {
      setStreamStatus("idle");
      return;
    }
    const es = new EventSource(streamUrl, { withCredentials: true });
    const queryKey = getListAssetsQueryKey(venueCode);
    setStreamStatus("connecting");
    let hasConnected = false;
    // Track the highest server seq we've already applied so an out-of-order
    // delivery (e.g. a stray duplicate from cross-instance fanout, or a
    // race between replay and live) can't overwrite newer state with an
    // older snapshot.
    let lastAppliedSeq = 0;
    const seqOf = (raw: MessageEvent): number => {
      const n = Number(raw.lastEventId);
      return Number.isFinite(n) ? n : 0;
    };

    const applyAsset = (incoming: ApiCustodyAsset) => {
      const local = toLocal(incoming);
      queryClient.setQueryData<CustodyAsset[] | undefined>(queryKey, (prev) => {
        if (!prev) return [local];
        const idx = prev.findIndex((row) => row.id === local.id);
        if (idx === -1) return [local, ...prev];
        const next = prev.slice();
        next[idx] = local;
        return next;
      });
    };

    const handle = (raw: MessageEvent) => {
      try {
        const seq = seqOf(raw);
        if (seq && seq <= lastAppliedSeq) return;
        const data = JSON.parse(raw.data) as {
          type: "asset.created" | "asset.released";
          asset: ApiCustodyAsset;
          actorEmail: string | null;
        };
        applyAsset(data.asset);
        if (seq) lastAppliedSeq = seq;
        const fromSelf =
          !!email && !!data.actorEmail &&
          data.actorEmail.toLowerCase() === email.toLowerCase();
        if (fromSelf) return;
        if (data.type === "asset.released") {
          toast({
            title: `Tag ${data.asset.ticketId} released`,
            description: `Returned to ${data.asset.patron.name} by ${data.asset.handler}.`,
          });
        } else {
          toast({
            title: `Tag ${data.asset.ticketId} issued`,
            description: `Logged in by ${data.asset.handler}.`,
          });
        }
      } catch {
        // ignore malformed payloads
      }
    };

    const handleTamper = (raw: MessageEvent) => {
      try {
        const seq = seqOf(raw);
        if (seq && seq <= lastAppliedSeq) return;
        const data = JSON.parse(raw.data) as {
          type: "signature.invalid";
          tamper: TamperEvent;
          actorEmail: string | null;
        };
        const unreadKey = getListTamperEventsQueryKey(venueCode, {
          acknowledged: false,
        });
        queryClient.setQueryData<TamperEvent[] | undefined>(unreadKey, (prev) =>
          prev ? [data.tamper, ...prev] : [data.tamper],
        );
        // New attempts may also belong in any currently-open filtered view —
        // refetch any tamper-events query for this venue. Generated query
        // keys are URL-prefixed (e.g. `/api/venues/<code>/tamper-events`),
        // so match by URL substring rather than a separate name token.
        queryClient.invalidateQueries({
          predicate: (q) => {
            const key = q.queryKey as readonly unknown[];
            return (
              typeof key[0] === "string" &&
              key[0].includes(`/venues/${venueCode}/tamper-events`)
            );
          },
        });
        if (seq) lastAppliedSeq = seq;
        toast({
          title: `Tamper attempt on ${data.tamper.ticketId ?? "unknown tag"}`,
          description: data.tamper.reason,
          variant: "destructive",
        });
      } catch {
        // ignore malformed payloads
      }
    };

    // Server-side replay covers reconnect gaps via Last-Event-ID, so we no
    // longer refetch the whole custody list on every reconnect. The server
    // emits a `reset` control event only when the gap is too large to
    // replay cheaply — in that case we fall back to one full refetch.
    const handleReset = (raw: MessageEvent) => {
      const seq = seqOf(raw);
      if (seq) lastAppliedSeq = seq;
      queryClient.invalidateQueries({ queryKey });
      queryClient.invalidateQueries({
        predicate: (q) => {
          const key = q.queryKey as readonly unknown[];
          return (
            typeof key[0] === "string" &&
            key[0].includes(`/venues/${venueCode}/tamper-events`)
          );
        },
      });
    };

    es.addEventListener("asset.created", handle as EventListener);
    es.addEventListener("asset.released", handle as EventListener);
    es.addEventListener("signature.invalid", handleTamper as EventListener);
    es.addEventListener("reset", handleReset as EventListener);
    es.onopen = () => {
      hasConnected = true;
      setStreamStatus("connected");
    };
    es.onerror = () => {
      // EventSource auto-reconnects; surface the disconnected state so the
      // UI can warn handlers their list may be stale until reconnect.
      if (es.readyState === EventSource.CLOSED) {
        setStreamStatus("disconnected");
      } else if (es.readyState === EventSource.CONNECTING) {
        setStreamStatus(hasConnected ? "disconnected" : "connecting");
      }
    };

    return () => {
      es.close();
      setStreamStatus("idle");
    };
  }, [venueCode, isSignedIn, queryClient, email]);

  const invalidate = useCallback(() => {
    if (!venueCode) return;
    queryClient.invalidateQueries({ queryKey: getListAssetsQueryKey(venueCode) });
  }, [queryClient, venueCode]);

  const intake = useCallback<StoreCtx["intake"]>(
    async (a) => {
      if (!session) throw new Error("Not signed in");
      const created = await createAsset(session.venueCode, {
        mode: a.mode,
        patron: a.patron,
        fields: a.fields,
        photos: a.photos,
        handlerEmail: session.email,
        handlerName: session.handlerName,
        venueName: session.venueName,
      });
      const local = toLocal(created);
      queryClient.setQueryData<CustodyAsset[] | undefined>(
        getListAssetsQueryKey(session.venueCode),
        (prev) => (prev ? [local, ...prev] : [local]),
      );
      invalidate();
      return local;
    },
    [session, queryClient, invalidate],
  );

  const release = useCallback<StoreCtx["release"]>(
    async (ticketId, opts) => {
      if (!session) return null;
      try {
        const updated = await releaseAsset(session.venueCode, ticketId, {
          handlerEmail: session.email,
          handlerName: session.handlerName,
          ...(opts?.signature ? { signature: opts.signature } : {}),
          ...(opts?.source ? { source: opts.source } : {}),
        });
        const local = toLocal(updated);
        queryClient.setQueryData<CustodyAsset[] | undefined>(
          getListAssetsQueryKey(session.venueCode),
          (prev) =>
            prev?.map((row) => (row.ticketId === local.ticketId ? local : row)) ??
            prev,
        );
        invalidate();
        return local;
      } catch {
        return null;
      }
    },
    [session, queryClient, invalidate],
  );

  const findByTicket = useCallback<StoreCtx["findByTicket"]>(
    async (ticketId) => {
      if (!session) return undefined;
      try {
        const found = await getAssetByTicket(session.venueCode, ticketId.trim());
        return toLocal(found);
      } catch {
        return undefined;
      }
    },
    [session],
  );

  const refreshMe = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ["me"] });
    await meQuery.refetch();
  }, [queryClient, meQuery]);

  const join: StoreCtx["joinVenue"] = useCallback(
    async (inviteToken) => {
      const { venues: next, joined } = await apiJoinVenue(inviteToken);
      queryClient.setQueryData(
        ["me"],
        (prev: typeof meQuery.data) => (prev ? { ...prev, venues: next } : prev),
      );
      if (joined?.code) setActiveVenueCodeState(joined.code.toUpperCase());
      return next;
    },
    [queryClient, meQuery.data],
  );

  const leave: StoreCtx["leaveVenue"] = useCallback(
    async (code) => {
      const { venues: next } = await apiLeaveVenue(code);
      queryClient.setQueryData(
        ["me"],
        (prev: typeof meQuery.data) => (prev ? { ...prev, venues: next } : prev),
      );
      setActiveVenueCodeState((cur) => (cur === code ? next[0]?.code ?? null : cur));
      return next;
    },
    [queryClient, meQuery.data],
  );

  const setActiveVenue = useCallback((code: string) => {
    setActiveVenueCodeState(code.toUpperCase());
  }, []);

  const signOutFn = useCallback(async () => {
    try {
      await apiLogout();
    } catch {
      // best effort — clear local state regardless of network result
    }
    setActiveVenueCodeState(null);
    try {
      localStorage.removeItem(ACTIVE_VENUE_KEY);
    } catch {}
    queryClient.clear();
    await queryClient.invalidateQueries({ queryKey: ["me"] });
  }, [queryClient]);

  const ready =
    Boolean(authLoaded) &&
    (!isSignedIn || (meQuery.isFetched && !meQuery.isLoading));

  const value = useMemo<StoreCtx>(
    () => ({
      ready,
      signedIn: Boolean(isSignedIn),
      session,
      venues,
      activeVenue,
      setActiveVenue,
      joinVenue: join,
      leaveVenue: leave,
      refreshMe,
      signOut: signOutFn,
      mode,
      effectiveModes,
      canAccessMode,
      authorization,
      assets,
      loading: assetsLoading,
      intake,
      release,
      findByTicket,
      streamStatus,
    }),
    [
      ready,
      isSignedIn,
      session,
      venues,
      activeVenue,
      setActiveVenue,
      join,
      leave,
      refreshMe,
      signOutFn,
      mode,
      effectiveModes,
      canAccessMode,
      authorization,
      assets,
      assetsLoading,
      intake,
      release,
      findByTicket,
      streamStatus,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useStore must be used inside StoreProvider");
  return v;
}
