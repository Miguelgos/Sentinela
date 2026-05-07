import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { AuthPeriodHours } from "@/lib/api";

interface Props {
  value: AuthPeriodHours;
  onChange: (v: AuthPeriodHours) => void;
}

const OPTIONS: { value: AuthPeriodHours; label: string }[] = [
  { value: 1,   label: "Última hora" },
  { value: 6,   label: "Últimas 6h" },
  { value: 24,  label: "Últimas 24h" },
  { value: 168, label: "Últimos 7 dias" },
  { value: 240, label: "Últimos 10 dias" },
];

export function PeriodSelect({ value, onChange }: Props) {
  return (
    <Select value={String(value)} onValueChange={(v) => onChange(Number(v) as AuthPeriodHours)}>
      <SelectTrigger className="h-9 w-44">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {OPTIONS.map((opt) => (
          <SelectItem key={opt.value} value={String(opt.value)}>{opt.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
