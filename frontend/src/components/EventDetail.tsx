import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { LevelBadge } from "@/components/LevelBadge";
import { type DbEvent } from "@/lib/api";
import { formatTimestamp, isEmptyGuid } from "@/lib/utils";

interface Props {
  event: DbEvent | null;
  onClose: () => void;
}

export function EventDetail({ event, onClose }: Props) {
  if (!event) return null;

  return (
    <Dialog open={!!event} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <LevelBadge level={event.level} />
            <span className="text-sm font-mono">{event.request_path || "—"}</span>
          </DialogTitle>
          <DialogDescription>{formatTimestamp(event.timestamp)}</DialogDescription>
        </DialogHeader>

        <ScrollArea className="h-[60vh]">
          <div className="space-y-4 pr-4">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <Field label="Serviço" value={event.service} />
              <Field label="Ambiente" value={event.environment} />
              <Field label="UserId" value={event.user_id} />
              <Field label="GUID Cotação">
                {event.guid_cotacao ? (
                  <span className={isEmptyGuid(event.guid_cotacao) ? "text-red-400 font-mono" : "font-mono"}>
                    {event.guid_cotacao}
                    {isEmptyGuid(event.guid_cotacao) && (
                      <Badge variant="error" className="ml-2 text-xs">GUID vazio</Badge>
                    )}
                  </span>
                ) : "—"}
              </Field>
              <Field label="Trace ID" value={event.trace_id} mono />
              <Field label="Source" value={event.source_context} />
            </div>

            <div>
              <p className="text-xs font-semibold text-muted-foreground mb-1">Mensagem</p>
              <pre className="text-xs bg-muted rounded p-3 whitespace-pre-wrap break-all">
                {event.message}
              </pre>
            </div>

            <div>
              <p className="text-xs font-semibold text-muted-foreground mb-1">Raw Data (JSON)</p>
              <pre className="text-xs bg-muted rounded p-3 overflow-auto whitespace-pre-wrap break-all">
                {JSON.stringify(event.raw_data, null, 2)}
              </pre>
            </div>
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  label, value, children, mono,
}: {
  label: string;
  value?: string | null;
  children?: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      {children ?? (
        <p className={`text-sm truncate ${mono ? "font-mono" : ""}`}>{value || "—"}</p>
      )}
    </div>
  );
}
