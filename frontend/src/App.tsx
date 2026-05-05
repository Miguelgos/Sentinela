import { useState } from "react";
import { LayoutDashboard, List, ShieldAlert, Globe, BarChart2, Flame, FileWarning, Activity, Layers, Eye, LogOut } from "lucide-react";
import { cn } from "@/lib/utils";
import { Separator } from "@/components/ui/separator";
import { Dashboard } from "@/components/Dashboard";
import { LogsTable } from "@/components/LogsTable";
import { AuthErrorAnalysis } from "@/components/AuthErrorAnalysis";
import { KongAuthAnalysis } from "@/components/KongAuthAnalysis";
import { DatadogAnalysis } from "@/components/DatadogAnalysis";
import { GoCacheAnalysis } from "@/components/GoCacheAnalysis";
import { ReportAnalysis } from "@/components/ReportAnalysis";
import { KubernetesAnalysis } from "@/components/KubernetesAnalysis";
import { AuditAnalysis } from "@/components/AuditAnalysis";
import { AnomalyAnalysis } from "@/components/AnomalyAnalysis";
import { SentinelaLogo } from "@/components/SentinelaLogo";
import { LoginPage } from "@/components/LoginPage";
import { useAuth } from "@/hooks/useAuth";

type Page = "dashboard" | "logs" | "auth-errors" | "kong-auth" | "datadog" | "gocache" | "report" | "anomaly" | "kubernetes" | "audit";

const NAV = [
  { id: "dashboard"   as Page, label: "Dashboard",              icon: LayoutDashboard },
  { id: "logs"        as Page, label: "Eventos",                icon: List },
  { id: "auth-errors" as Page, label: "Falhas de Autenticação", icon: ShieldAlert },
  { id: "kong-auth"   as Page, label: "Kong Auth",              icon: Globe },
  { id: "datadog"     as Page, label: "Datadog",                icon: BarChart2 },
  { id: "gocache"      as Page, label: "GoCache WAF",            icon: Flame },
  { id: "report"       as Page, label: "Relatório de Ameaças",   icon: FileWarning },
  { id: "anomaly"      as Page, label: "Anomalias",               icon: Activity },
  { id: "kubernetes"   as Page, label: "Kubernetes",             icon: Layers },
  { id: "audit"        as Page, label: "Auditoria",              icon: Eye },
];

export default function App() {
  const [page, setPage] = useState<Page>("dashboard");
  const { session, loading, signIn, signInWithMicrosoft, signOut } = useAuth();

  const PageTitle: Record<Page, string> = {
    dashboard:    "Dashboard",
    logs:         "Eventos",
    "auth-errors":"Análise — Falhas de Autenticação",
    "kong-auth":  "Análise — Kong Auth Request",
    datadog:      "Datadog — Infraestrutura & Monitores",
    gocache:      "GoCache WAF — Proteção & Ataques",
    report:       "Relatório de Ameaças Cibernéticas",
    anomaly:      "Detecção de Anomalias (Davis-style)",
    kubernetes:   "Kubernetes — Saúde do Cluster",
    audit:        "Auditoria — Logs de Acesso",
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  if (!session) {
    return <LoginPage onSignIn={signIn} onSignInWithMicrosoft={signInWithMicrosoft} />;
  }

  return (
    <div className="flex h-screen bg-background text-foreground">
      <aside className="w-56 border-r flex flex-col py-4 shrink-0">
        <div className="px-3 mb-4">
          <SentinelaLogo className="w-full rounded-md" />
          <p className="text-xs text-muted-foreground text-center mt-1.5">Ituran · Integra</p>
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
        <div className="px-3 pt-2 border-t space-y-2">
          <p className="text-xs text-muted-foreground truncate" title={session.user.email}>
            {session.user.email}
          </p>
          <button
            onClick={() => signOut()}
            className="w-full flex items-center gap-2 px-3 py-1.5 rounded-md text-xs text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
          >
            <LogOut className="h-3.5 w-3.5 shrink-0" />
            Sair
          </button>
        </div>
      </aside>

      <main className="flex-1 overflow-auto">
        <header className="sticky top-0 z-10 border-b bg-background/80 backdrop-blur px-6 py-3">
          <h1 className="text-base font-semibold">{PageTitle[page]}</h1>
        </header>
        <div className="p-6">
          {page === "dashboard"   && <Dashboard />}
          {page === "logs"        && <LogsTable />}
          {page === "auth-errors" && <AuthErrorAnalysis />}
          {page === "kong-auth"   && <KongAuthAnalysis />}
          {page === "datadog"     && <DatadogAnalysis />}
          {page === "gocache"      && <GoCacheAnalysis />}
          {page === "report"       && <ReportAnalysis />}
          {page === "anomaly"      && <AnomalyAnalysis />}
          {page === "kubernetes"   && <KubernetesAnalysis />}
          {page === "audit"        && <AuditAnalysis />}
        </div>
      </main>
    </div>
  );
}
