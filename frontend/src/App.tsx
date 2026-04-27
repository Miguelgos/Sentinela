import { useState } from "react";
import { LayoutDashboard, List, AlertTriangle, ShieldAlert, ShieldCheck, Globe, BarChart2, Flame, FileWarning, Layers, Cpu } from "lucide-react";
import { cn } from "@/lib/utils";
import { Separator } from "@/components/ui/separator";
import { Dashboard } from "@/components/Dashboard";
import { LogsTable } from "@/components/LogsTable";
import { ErrorAnalysis } from "@/components/ErrorAnalysis";
import { AuthErrorAnalysis } from "@/components/AuthErrorAnalysis";
import { SecurityAnalysis } from "@/components/SecurityAnalysis";
import { KongAuthAnalysis } from "@/components/KongAuthAnalysis";
import { DatadogAnalysis } from "@/components/DatadogAnalysis";
import { GoCacheAnalysis } from "@/components/GoCacheAnalysis";
import { ReportAnalysis } from "@/components/ReportAnalysis";
import { KubernetesAnalysis } from "@/components/KubernetesAnalysis";
import { JobSchedulerAnalysis } from "@/components/JobSchedulerAnalysis";
import { SentinelaLogo } from "@/components/SentinelaLogo";

type Page = "dashboard" | "logs" | "analysis" | "auth-errors" | "security" | "kong-auth" | "datadog" | "gocache" | "report" | "kubernetes" | "jobscheduler";

const NAV = [
  { id: "dashboard"   as Page, label: "Dashboard",              icon: LayoutDashboard },
  { id: "logs"        as Page, label: "Eventos",                icon: List },
  { id: "analysis"    as Page, label: "GUID Cotação vazio",     icon: AlertTriangle },
  { id: "auth-errors" as Page, label: "Falhas de Autenticação", icon: ShieldAlert },
  { id: "kong-auth"   as Page, label: "Kong Auth",              icon: Globe },
  { id: "security"    as Page, label: "Segurança",              icon: ShieldCheck },
  { id: "datadog"     as Page, label: "Datadog",                icon: BarChart2 },
  { id: "gocache"      as Page, label: "GoCache WAF",            icon: Flame },
  { id: "report"       as Page, label: "Relatório de Ameaças",   icon: FileWarning },
  { id: "kubernetes"   as Page, label: "Kubernetes",             icon: Layers },
  { id: "jobscheduler" as Page, label: "JobScheduler",           icon: Cpu },
];

export default function App() {
  const [page, setPage] = useState<Page>("dashboard");

  const PageTitle: Record<Page, string> = {
    dashboard:    "Dashboard",
    logs:         "Eventos",
    analysis:     "Análise — GUID Cotação vazio",
    "auth-errors":"Análise — Falhas de Autenticação",
    "kong-auth":  "Análise — Kong Auth Request",
    security:     "Análise de Segurança",
    datadog:      "Datadog — Infraestrutura & Monitores",
    gocache:      "GoCache WAF — Proteção & Ataques",
    report:       "Relatório de Ameaças Cibernéticas",
    kubernetes:   "Kubernetes — Saúde do Cluster",
    jobscheduler: "JobScheduler — Execução de Jobs",
  };

  return (
    <div className="flex h-screen bg-background text-foreground">
      <aside className="w-56 border-r flex flex-col py-4 shrink-0">
        <div className="px-3 mb-4">
          <SentinelaLogo className="w-full rounded-md" />
          <p className="text-xs text-muted-foreground text-center mt-1.5">Ituran · salesbo</p>
        </div>
        <Separator className="mb-2" />
        <nav className="flex-1 px-2 space-y-1">
          {NAV.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setPage(id)}
              className={cn(
                "w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors",
                page === id
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground"
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {label}
            </button>
          ))}
        </nav>
        <div className="px-4 pt-2 border-t">
          <p className="text-xs text-muted-foreground">integra-prd</p>
          <p className="text-xs text-muted-foreground">salesbo</p>
        </div>
      </aside>

      <main className="flex-1 overflow-auto">
        <header className="sticky top-0 z-10 border-b bg-background/80 backdrop-blur px-6 py-3">
          <h1 className="text-base font-semibold">{PageTitle[page]}</h1>
        </header>
        <div className="p-6">
          {page === "dashboard"   && <Dashboard />}
          {page === "logs"        && <LogsTable />}
          {page === "analysis"    && <ErrorAnalysis />}
          {page === "auth-errors" && <AuthErrorAnalysis />}
          {page === "kong-auth"   && <KongAuthAnalysis />}
          {page === "security"    && <SecurityAnalysis />}
          {page === "datadog"     && <DatadogAnalysis />}
          {page === "gocache"      && <GoCacheAnalysis />}
          {page === "report"       && <ReportAnalysis />}
          {page === "kubernetes"   && <KubernetesAnalysis />}
          {page === "jobscheduler" && <JobSchedulerAnalysis />}
        </div>
      </main>
    </div>
  );
}
