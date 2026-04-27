import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { AlertCircle, RefreshCw } from "lucide-react";

interface Props {
  loading: boolean;
  error: string | null;
  onReload: () => void;
  skeletonRows?: number;
  children: React.ReactNode;
  action?: React.ReactNode;
  title?: string;
}

export function AnalysisShell({ loading, error, onReload, skeletonRows = 4, children, action, title }: Props) {
  if (loading) {
    return (
      <div className="space-y-4">
        {title && (
          <div className="flex justify-between items-center">
            <h2 className="text-sm font-medium text-muted-foreground">{title}</h2>
          </div>
        )}
        {Array.from({ length: skeletonRows }).map((_, i) => (
          <Skeleton key={i} className="h-24 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-6 flex items-start gap-3">
        <AlertCircle className="h-5 w-5 text-destructive mt-0.5 shrink-0" />
        <div className="flex-1">
          <p className="text-sm font-medium text-destructive">Erro ao carregar dados</p>
          <p className="text-xs text-muted-foreground mt-1">{error}</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={onReload}>
            <RefreshCw className="h-3 w-3 mr-1" /> Tentar novamente
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {(title || action) && (
        <div className="flex justify-between items-center">
          {title && <h2 className="text-sm font-medium text-muted-foreground">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </div>
  );
}
