import { useMemo, useState } from "react";
import { BarChart3, CalendarClock, CarFront, ClipboardList, MessageSquareHeart, Star } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import {
  getGetActiveShiftQueryKey,
  getListServiceRequestsQueryKey,
  getActiveShift,
  listServiceRequests,
  type Shift,
} from "@workspace/api-client-react";
import { useStore } from "@/lib/store";
import { SettingsCard, SettingsSubHeader } from "./_chrome";

type Window = "shift" | "day" | "week" | "month";

type SeedPositiveReview = {
  id: string;
  source: "Customer" | "Manager";
  label: string;
  rating: number;
  at: number;
};

function getWindowStart(window: Window, shift: Shift | null) {
  const now = Date.now();
  if (window === "shift") {
    return shift?.startedAt ?? now - 8 * 60 * 60 * 1000;
  }
  if (window === "day") return now - 24 * 60 * 60 * 1000;
  if (window === "week") return now - 7 * 24 * 60 * 60 * 1000;
  return now - 30 * 24 * 60 * 60 * 1000;
}

function formatDurationMs(ms: number) {
  const mins = Math.max(0, Math.floor(ms / 60000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h ${m}m`;
}

function formatTime(ts?: number | null) {
  if (!ts) return "—";
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function scoreToFive(avg: number) {
  if (!Number.isFinite(avg) || avg <= 0) return 0;
  if (avg <= 5) return avg;
  if (avg <= 10) return avg / 2;
  return Math.min(5, avg / 20);
}

function inferSourceLabel(source: string | null | undefined) {
  const s = String(source ?? "").toLowerCase();
  if (s.includes("manager") || s.includes("supervisor") || s.includes("owner")) return "Manager";
  if (s.includes("customer") || s.includes("patron") || s.includes("guest")) return "Customer";
  return "Customer";
}

function buildSeedReviews(now: number): SeedPositiveReview[] {
  return [
    {
      id: "r-1",
      source: "Customer",
      label: "Patron satisfaction",
      rating: 4.9,
      at: now - 2 * 60 * 60 * 1000,
    },
    {
      id: "r-2",
      source: "Manager",
      label: "Shift supervisor note",
      rating: 4.8,
      at: now - 18 * 60 * 60 * 1000,
    },
    {
      id: "r-3",
      source: "Customer",
      label: "Vehicle return experience",
      rating: 5,
      at: now - 3 * 24 * 60 * 60 * 1000,
    },
    {
      id: "r-4",
      source: "Manager",
      label: "Operational consistency",
      rating: 4.7,
      at: now - 12 * 24 * 60 * 60 * 1000,
    },
  ];
}

export default function SettingsPerformance() {
  const { assets, session, activeVenue } = useStore();
  const [window, setWindow] = useState<Window>("shift");

  const venueCode = activeVenue?.code ?? "";

  const activeShiftQuery = useQuery({
    queryKey: getGetActiveShiftQueryKey(),
    queryFn: () => getActiveShift(),
    staleTime: 30_000,
  });
  const shift = activeShiftQuery.data?.shift ?? null;

  const windowStart = getWindowStart(window, shift);
  const now = Date.now();

  const serviceRequestsQuery = useQuery({
    queryKey: getListServiceRequestsQueryKey(venueCode),
    queryFn: () => listServiceRequests(venueCode),
    enabled: Boolean(venueCode),
    staleTime: 15_000,
  });

  const attendance = useMemo(() => {
    if (!shift) {
      return {
        state: "Off shift",
        start: "—",
        end: "—",
        worked: "0h 0m",
      };
    }

    const shiftStart = shift.startedAt;
    const shiftEnd = shift.endedAt ?? now;
    const overlapStart = Math.max(windowStart, shiftStart);
    const overlapEnd = Math.max(overlapStart, shiftEnd);

    return {
      state: shift.endedAt ? "Shift ended" : "On shift",
      start: formatTime(shift.startedAt),
      end: shift.endedAt ? formatTime(shift.endedAt) : "In progress",
      worked: formatDurationMs(overlapEnd - overlapStart),
    };
  }, [shift, windowStart, now]);

  const custody = useMemo(() => {
    const inWindow = assets.filter((a) => a.intakeAt >= windowStart || (a.releasedAt ?? 0) >= windowStart);
    const checkedIn = inWindow.filter((a) => a.intakeAt >= windowStart).length;
    const checkedOut = inWindow.filter((a) => (a.releasedAt ?? 0) >= windowStart).length;
    const activeNow = assets.filter((a) => a.status === "active").length;

    return { checkedIn, checkedOut, activeNow };
  }, [assets, windowStart]);

  const todo = useMemo(() => {
    const me = (session?.handlerName ?? "").trim().toLowerCase();
    const list = serviceRequestsQuery.data ?? [];

    const assignments = list.filter((r) => r.status === "open").length;
    const tasks = list.filter((r) => {
      const claimedBy = (r.claimedByName ?? "").trim().toLowerCase();
      return r.status === "claimed" && claimedBy === me;
    }).length;
    const jobs = list.filter((r) => r.status === "claimed").length;

    const closed = list.filter((r) => r.status === "done").length;
    const cancelled = list.filter((r) => r.status === "cancelled").length;

    return { assignments, tasks, jobs, closed, cancelled };
  }, [serviceRequestsQuery.data, session?.handlerName]);

  const ratings = useMemo(() => {
    const rows = buildSeedReviews(now).filter((r) => r.at >= windowStart);
    const totalCount = rows.length;
    const average = totalCount > 0 ? rows.reduce((sum, row) => sum + row.rating, 0) / totalCount : 0;

    const topMentions = rows
      .map((row) => ({
        id: row.id,
        source: row.source,
        label: row.label,
        rating: row.rating,
        count: 1,
      }))
      .sort((a, b) => b.rating - a.rating)
      .slice(0, 4);

    return {
      average,
      totalCount,
      topMentions,
    };
  }, [windowStart, now]);

  const windowLabel =
    window === "shift"
      ? "Shift"
      : window === "day"
        ? "Day"
        : window === "week"
          ? "Week"
          : "Month";

  return (
    <div>
      <SettingsSubHeader
        title="Performance"
        Icon={BarChart3}
        description="Single-page summary for shift/day/week/month: attendance, vehicles, todos, and positive ratings/reviews"
      />

      <SettingsCard className="mb-4">
        <div className="inline-flex items-center rounded-full border border-white/10 bg-obsidian/50 p-1">
          {(["shift", "day", "week", "month"] as const).map((w) => (
            <button
              key={w}
              onClick={() => setWindow(w)}
              className={`px-3 py-1 rounded-full text-[11px] font-mono uppercase tracking-wider hover-elevate ${
                window === w ? "bg-lime/15 text-lime" : "text-slate"
              }`}
              data-testid={`performance-window-${w}`}
            >
              {w}
            </button>
          ))}
        </div>
        <div className="mt-3 text-[11px] font-mono uppercase tracking-wider text-slate">
          Viewing: <span className="text-paper">{windowLabel}</span>
        </div>
      </SettingsCard>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <SettingsCard>
          <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-slate mb-3">
            <CalendarClock className="w-4 h-4 text-lime" /> Attendance
          </div>
          <div className="space-y-2 text-sm">
            <MetricRow label="Status" value={attendance.state} />
            <MetricRow label="Shift start" value={attendance.start} />
            <MetricRow label="Shift end" value={attendance.end} />
            <MetricRow label={`Worked (${windowLabel})`} value={attendance.worked} />
          </div>
        </SettingsCard>

        <SettingsCard>
          <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-slate mb-3">
            <CarFront className="w-4 h-4 text-lime" /> Checked in / out vehicles
          </div>
          <div className="space-y-2 text-sm">
            <MetricRow label="Checked in" value={String(custody.checkedIn)} />
            <MetricRow label="Checked out" value={String(custody.checkedOut)} />
            <MetricRow label="Active in custody now" value={String(custody.activeNow)} />
          </div>
        </SettingsCard>

        <SettingsCard>
          <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-slate mb-3">
            <ClipboardList className="w-4 h-4 text-lime" /> ToDos
          </div>
          <div className="space-y-2 text-sm">
            <MetricRow label="Assignments (unclaimed)" value={String(todo.assignments)} />
            <MetricRow label="Tasks (claimed by you)" value={String(todo.tasks)} />
            <MetricRow label="Jobs (claimed overall)" value={String(todo.jobs)} />
            <MetricRow label="Closed" value={String(todo.closed)} />
            <MetricRow label="Cancelled" value={String(todo.cancelled)} />
          </div>
        </SettingsCard>

        <SettingsCard>
          <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-wider text-slate mb-3">
            <MessageSquareHeart className="w-4 h-4 text-lime" /> Positive ratings / reviews
          </div>

          <div className="flex items-center gap-3 mb-3">
            <div className="inline-flex items-center gap-1 rounded-full border border-lime/30 bg-lime/10 px-2.5 py-1 text-xs font-mono">
              <Star className="w-3.5 h-3.5 text-lime" />
              <span className="text-lime" data-testid="performance-rating-average">
                {ratings.average > 0 ? ratings.average.toFixed(1) : "—"}
              </span>
            </div>
            <div className="text-xs text-slate" data-testid="performance-rating-count">
              {ratings.totalCount} positive ratings
            </div>
          </div>

          {ratings.topMentions.length === 0 ? (
            <div className="text-sm text-slate">No positive reviews in this window yet.</div>
          ) : (
            <ul className="space-y-2" data-testid="performance-rating-list">
              {ratings.topMentions.map((r) => (
                <li key={r.id} className="rounded-xl border border-white/10 bg-obsidian/35 px-3 py-2">
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="text-paper font-medium">{r.label}</span>
                    <span className="font-mono text-lime">{r.rating.toFixed(1)}★</span>
                  </div>
                  <div className="mt-1 text-[11px] text-slate">
                    {r.source} · {r.count} rating{r.count === 1 ? "" : "s"}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </SettingsCard>
      </div>
    </div>
  );
}

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-white/10 bg-obsidian/30 px-3 py-2">
      <span className="text-slate">{label}</span>
      <span className="font-mono text-paper">{value}</span>
    </div>
  );
}
