import { useQuery } from "@tanstack/react-query";
import { getEventsStatus } from "@/../../app/server/fn/events";

export function SyncBanner() {
  const { data } = useQuery({
    queryKey: ["events-status"],
    queryFn: () => getEventsStatus(),
    // Só faz polling enquanto o sync inicial está rodando. Quando vira "done"
    // o polling para e o banner some — evita 1 RPC/5s/aba 24/7.
    refetchInterval: (q) =>
      q.state.data?.progress?.phase === "syncing" ? 5_000 : false,
  });

  const progress = data?.progress;
  if (!progress || progress.phase !== "syncing") return null;

  const { daysDone, daysTotal, loaded } = progress;
  const pct = daysTotal > 0 ? Math.round((daysDone / daysTotal) * 100) : 0;

  return (
    <div className="border-b border-amber-500/30 bg-amber-500/10 text-amber-100 px-4 py-2 text-sm">
      <div className="flex items-center justify-between max-w-7xl mx-auto gap-4">
        <span>
          Sincronizando histórico do Seq —{" "}
          <strong>
            {daysDone}/{daysTotal} dias
          </strong>{" "}
          ({loaded.toLocaleString("pt-BR")} eventos carregados)
        </span>
        <div className="w-32 h-1.5 bg-amber-900/40 rounded overflow-hidden">
          <div
            className="h-full bg-amber-400 transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    </div>
  );
}
