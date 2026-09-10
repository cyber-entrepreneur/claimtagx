import { useMemo } from "react";
import { Redirect, useLocation } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Clock3,
  Play,
  Users,
  Building2,
  AlertTriangle,
  Loader2,
} from "lucide-react";
import {
  endShift,
  getActiveShift,
  getGetActiveShiftQueryKey,
  getListActiveVenueShiftsQueryKey,
  listActiveVenueShifts,
  startShift,
} from "@workspace/api-client-react";
import { useStore } from "@/lib/store";
import { toast } from "@/hooks/use-toast";

function shiftLabel(startedAt: number): string {
  return new Date(startedAt).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function PreShiftPage() {
  const { session, activeVenue } = useStore();
  const [, navigate] = useLocation();
  const queryClient = useQueryClient();
  const venueCode = activeVenue?.code ?? "";

  const activeShiftQuery = useQuery({
    queryKey: getGetActiveShiftQueryKey(),
    queryFn: () => getActiveShift(),
    enabled: Boolean(session),
    staleTime: 30_000,
  });

  const venueShiftsQuery = useQuery({
    queryKey: getListActiveVenueShiftsQueryKey(venueCode),
    queryFn: () => listActiveVenueShifts(venueCode),
    enabled: Boolean(venueCode),
    staleTime: 30_000,
  });

  const shift = activeShiftQuery.data?.shift ?? null;
  const myShiftHere = Boolean(shift && venueCode && shift.venueCode === venueCode);
  const shiftElsewhere = shift && venueCode && shift.venueCode !== venueCode ? shift : null;

  const teammatesCount = useMemo(() => {
    const rows = venueShiftsQuery.data ?? [];
    if (!myShiftHere || !shift) return rows.length;
    return rows.filter((row) => row.id !== shift.id).length;
  }, [venueShiftsQuery.data, myShiftHere, shift]);

  const startMutation = useMutation({
    mutationFn: () => startShift({ venueCode }),
    onSuccess: (nextShift) => {
      queryClient.setQueryData(getGetActiveShiftQueryKey(), { shift: nextShift });
      queryClient.invalidateQueries({
        queryKey: getListActiveVenueShiftsQueryKey(venueCode),
      });
      toast({
        title: "Shift started",
        description: `Clocked in at ${shiftLabel(nextShift.startedAt)}.`,
      });
      navigate("/");
    },
    onError: (err: Error) => {
      toast({
        title: "Could not start shift",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const endOtherMutation = useMutation({
    mutationFn: (id: string) => endShift(id),
    onSuccess: () => {
      queryClient.setQueryData(getGetActiveShiftQueryKey(), { shift: null });
      queryClient.invalidateQueries({
        queryKey: getListActiveVenueShiftsQueryKey(venueCode),
      });
      toast({
        title: "Other shift ended",
        description: "You can now start your shift here.",
      });
    },
    onError: (err: Error) => {
      toast({
        title: "Could not end other shift",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  if (myShiftHere) return <Redirect to="/" />;

  return (
    <div className="space-y-5" data-testid="page-pre-shift">
      <section className="rounded-3xl border border-white/10 bg-steel/40 p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <div className="w-12 h-12 rounded-2xl bg-lime/15 border border-lime/30 flex items-center justify-center shrink-0">
            <Play className="w-6 h-6 text-lime" />
          </div>
          <div className="min-w-0">
            <div className="text-[11px] font-mono uppercase tracking-wider text-slate">
              Shift check-in
            </div>
            <h1 className="text-xl sm:text-2xl font-extrabold text-white tracking-tight truncate">
              Start your shift
            </h1>
            <p className="mt-2 text-sm text-slate leading-relaxed">
              Confirm your station details, then start shift to enter Command Center.
            </p>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
          <InfoBlock
            icon={<Building2 className="w-4 h-4 text-lime" />}
            label="Station"
            value={activeVenue?.name ?? session?.venueName ?? "No station selected"}
            detail={activeVenue?.code ?? session?.venueCode ?? "—"}
          />
          <InfoBlock
            icon={<Clock3 className="w-4 h-4 text-lime" />}
            label="Target shift"
            value="8 hours"
            detail="Default duration"
          />
          <InfoBlock
            icon={<Users className="w-4 h-4 text-lime" />}
            label="On shift now"
            value={String(teammatesCount)}
            detail="At this station"
          />
        </div>

        {shiftElsewhere ? (
          <div className="mt-4 rounded-2xl border border-amber-400/30 bg-amber-500/10 p-3 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-300 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0 text-xs text-amber-100 leading-relaxed">
              <div>
                You already have an active shift at <span className="font-semibold">{shiftElsewhere.venueCode}</span> since {shiftLabel(shiftElsewhere.startedAt)}.
                End it first before starting one here.
              </div>
              <div className="mt-2">
                <button
                  type="button"
                  onClick={() => endOtherMutation.mutate(shiftElsewhere.id)}
                  disabled={endOtherMutation.isPending}
                  className="inline-flex items-center gap-2 rounded-lg border border-amber-400/40 bg-amber-500/15 text-amber-100 px-3 py-1.5 text-xs font-semibold hover-elevate disabled:opacity-60"
                  data-testid="button-end-other-shift"
                >
                  {endOtherMutation.isPending ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : null}
                  End shift at {shiftElsewhere.venueCode}
                </button>
              </div>
            </div>
          </div>
        ) : null}

        <div className="mt-4 flex justify-end">
          <button
            type="button"
            onClick={() => startMutation.mutate()}
            disabled={startMutation.isPending || !venueCode || Boolean(shiftElsewhere)}
            className="inline-flex items-center gap-2 rounded-xl border border-lime/40 bg-lime/15 text-lime px-4 py-2 text-sm font-semibold hover-elevate disabled:opacity-60"
            data-testid="button-start-shift-pre"
          >
            {startMutation.isPending ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Play className="w-4 h-4" />
            )}
            {startMutation.isPending ? "Starting…" : "Start shift"}
          </button>
        </div>
      </section>
    </div>
  );
}

function InfoBlock({
  icon,
  label,
  value,
  detail,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-obsidian/40 p-3">
      <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-wider text-slate">
        {icon}
        {label}
      </div>
      <div className="mt-1 text-sm font-semibold text-white truncate">{value}</div>
      <div className="text-[10px] text-slate font-mono">{detail}</div>
    </div>
  );
}