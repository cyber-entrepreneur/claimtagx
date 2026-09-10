import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { ArrowLeft, MessageSquare, Send, Loader2 } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  getGetUnreadMessageCountQueryKey,
  getListMessagesQueryKey,
  listMessages,
  markMessagesRead,
  postMessage,
} from "@workspace/api-client-react";
import { useStore } from "@/lib/store";
import { toast } from "@/hooks/use-toast";

function timeShort(ts: number): string {
  return new Date(ts).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

function dayLabel(ts: number): string {
  const d = new Date(ts);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return "Today";
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

export default function MessagesPage() {
  const { activeVenue, session } = useStore();
  const venueCode = activeVenue?.code ?? "";
  const queryClient = useQueryClient();
  const [body, setBody] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const list = useQuery({
    queryKey: getListMessagesQueryKey(venueCode),
    queryFn: () => listMessages(venueCode),
    enabled: Boolean(venueCode),
    refetchInterval: 5_000,
  });

  // Mark as read whenever the page is open and there are messages.
  useEffect(() => {
    if (!venueCode) return;
    let cancelled = false;
    (async () => {
      try {
        await markMessagesRead(venueCode);
        if (!cancelled) {
          queryClient.invalidateQueries({
            queryKey: getGetUnreadMessageCountQueryKey(venueCode),
          });
        }
      } catch {
        // best effort
      }
    })();
    const id = window.setInterval(() => {
      markMessagesRead(venueCode)
        .then(() =>
          queryClient.invalidateQueries({
            queryKey: getGetUnreadMessageCountQueryKey(venueCode),
          }),
        )
        .catch(() => {});
    }, 15_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [venueCode, queryClient, list.data?.length]);

  // Auto-scroll to bottom when messages change.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [list.data?.length]);

  const post = useMutation({
    mutationFn: (text: string) => postMessage(venueCode, { body: text }),
    onSuccess: () => {
      setBody("");
      queryClient.invalidateQueries({
        queryKey: getListMessagesQueryKey(venueCode),
      });
      queryClient.invalidateQueries({
        queryKey: getGetUnreadMessageCountQueryKey(venueCode),
      });
    },
    onError: (e: Error) =>
      toast({ title: "Could not send", description: e.message, variant: "destructive" }),
  });

  const messages = list.data ?? [];
  const myEmail = session?.email ?? "";

  return (
    <div className="flex flex-col h-[calc(100vh-12rem)]" data-testid="page-messages">
      <div className="flex items-center justify-between mb-3">
        <Link
          href="/"
          className="inline-flex items-center gap-1 text-xs font-mono uppercase tracking-wider text-slate hover:text-paper hover-elevate rounded-full px-2 py-1"
          data-testid="link-back-home"
        >
          <ArrowLeft className="w-3.5 h-3.5" /> Command Center
        </Link>
        <div className="inline-flex items-center gap-2 text-[11px] font-mono uppercase tracking-wider text-amber-300">
          <MessageSquare className="w-3.5 h-3.5" /> {activeVenue?.name ?? "Venue"} chat
        </div>
      </div>

      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto rounded-3xl border border-white/10 bg-steel/30 p-3 space-y-2"
        data-testid="list-messages"
      >
        {list.isLoading ? (
          <div className="text-sm text-slate">Loading…</div>
        ) : messages.length === 0 ? (
          <div className="text-sm text-slate text-center py-12">
            No messages yet. Say hi to your shift lead.
          </div>
        ) : (
          messages.map((m, i) => {
            const prev = messages[i - 1];
            const showDay =
              !prev || dayLabel(prev.createdAt) !== dayLabel(m.createdAt);
            // Self-detection: the server identifies the author by account id
            // but that's not exposed client-side. Match by display name as a
            // close-enough heuristic for visual alignment.
            const mine = m.authorName === (session?.handlerName ?? "");
            return (
              <div key={m.id}>
                {showDay && (
                  <div className="text-center text-[10px] font-mono uppercase tracking-wider text-slate my-2">
                    {dayLabel(m.createdAt)}
                  </div>
                )}
                <div
                  className={`flex ${mine ? "justify-end" : "justify-start"}`}
                  data-testid={`row-message-${m.id}`}
                >
                  <div
                    className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${
                      mine
                        ? "bg-lime/20 border border-lime/30 text-paper"
                        : "bg-obsidian/60 border border-white/10 text-paper"
                    }`}
                  >
                    {!mine && (
                      <div className="text-[10px] font-mono uppercase tracking-wider text-slate mb-0.5">
                        {m.authorName}
                      </div>
                    )}
                    <div className="whitespace-pre-wrap break-words">
                      {m.body}
                    </div>
                    <div className="text-[10px] font-mono text-slate mt-1 text-right">
                      {timeShort(m.createdAt)}
                    </div>
                  </div>
                </div>
              </div>
            );
          })
        )}
        {/* myEmail kept referenced for future per-user mentions feature */}
        <div className="hidden">{myEmail}</div>
      </div>

      <form
        className="mt-3 flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const text = body.trim();
          if (!text) return;
          post.mutate(text);
        }}
        data-testid="form-post-message"
      >
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              const text = body.trim();
              if (text) post.mutate(text);
            }
          }}
          placeholder="Message your team…"
          rows={1}
          className="flex-1 rounded-2xl border border-white/10 bg-obsidian/60 px-3 py-2 text-sm text-white placeholder:text-slate resize-none max-h-32"
          data-testid="input-message"
        />
        <button
          type="submit"
          disabled={!body.trim() || post.isPending}
          className="inline-flex items-center gap-1 rounded-2xl border border-amber-400/40 bg-amber-500/15 text-amber-200 px-4 py-2 text-sm font-semibold hover-elevate disabled:opacity-60"
          data-testid="button-send-message"
        >
          {post.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
        </button>
      </form>
    </div>
  );
}
