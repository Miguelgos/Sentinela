import { Card, CardContent } from "@/components/ui/card";
import type { ReactNode } from "react";

type Tone = "neutral" | "success" | "warning" | "danger" | "info" | "purple";

const VALUE_COLOR: Record<Tone, string> = {
  neutral: "",
  success: "text-green-300",
  warning: "text-yellow-300",
  danger:  "text-red-300",
  info:    "text-blue-300",
  purple:  "text-purple-300",
};

const BORDER_COLOR: Record<Tone, string> = {
  neutral: "",
  success: "border-green-500/20",
  warning: "border-yellow-500/30",
  danger:  "border-red-500/40 ring-1 ring-red-500/30",
  info:    "border-blue-500/30",
  purple:  "border-purple-500/30",
};

interface Props {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: Tone;
  emphasizeBorder?: boolean;
  icon?: ReactNode;
}

export function StatCard({ label, value, sub, tone = "neutral", emphasizeBorder, icon }: Props) {
  const cls = emphasizeBorder ? BORDER_COLOR[tone] : "";
  if (icon) {
    return (
      <Card className={cls}>
        <CardContent className="p-4 flex items-center gap-3">
          {icon}
          <div>
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className={`text-2xl font-bold ${VALUE_COLOR[tone]}`}>{value}</p>
            {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
          </div>
        </CardContent>
      </Card>
    );
  }
  return (
    <Card className={cls}>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className={`text-2xl font-bold ${VALUE_COLOR[tone]}`}>{value}</p>
        {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  );
}
