import { Badge } from "@/components/ui/badge";
import { type VariantProps } from "class-variance-authority";
import { badgeVariants } from "@/components/ui/badge";

type BadgeVariant = VariantProps<typeof badgeVariants>["variant"];

const LEVEL_MAP: Record<string, BadgeVariant> = {
  Error: "error",
  Warning: "warning",
  Information: "info",
  Debug: "debug",
  Fatal: "destructive",
  Verbose: "debug",
};

export function LevelBadge({ level }: { level: string }) {
  const variant = LEVEL_MAP[level] ?? "outline";
  return <Badge variant={variant}>{level}</Badge>;
}
