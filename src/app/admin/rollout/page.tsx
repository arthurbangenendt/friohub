import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { RolloutForm } from "./RolloutForm";

/* Antes esta tela só listava 4 flags de UX, hardcoded — as 5 restantes
   (que ligam cobrança real, assinatura de profissional, destaque pago e a
   migração pro Chatwoot) existiam no banco e a RPC `configurar_feature_flag`
   já autorizava o admin a mexer nelas, mas não havia UI nenhuma: a única
   forma de ligá-las era UPDATE direto em migration (ver
   20260819180000_ativar_asaas_payments.sql). Flag desconhecida cai no rótulo
   cru — a tela nunca escapa nenhuma flag por falta de entrada no mapa. */
const DESCRITOR: Record<string, { label: string; categoria: "produto" | "financeiro" }> = {
  ux_pipeline: { label: "Pipeline e confiança", categoria: "produto" },
  ux_execution: { label: "Execução profissional", categoria: "produto" },
  ux_portfolio: { label: "Carteira e recorrência", categoria: "produto" },
  ux_growth: { label: "Gestão e crescimento", categoria: "produto" },
  pmoc: { label: "Operação recorrente de PMOC", categoria: "produto" },
  sponsored_placements: { label: "Destaques pagos e rotulados", categoria: "financeiro" },
  professional_subscriptions: { label: "Cobrança recorrente de profissionais", categoria: "financeiro" },
  asaas_payments: { label: "Cobranças e webhooks reais via Asaas", categoria: "financeiro" },
  chatwoot_messaging: { label: "Conversas omnichannel pelo Chatwoot", categoria: "financeiro" },
};

function descritor(flagKey: string) {
  return DESCRITOR[flagKey] ?? { label: flagKey, categoria: "produto" as const };
}

export default async function RolloutPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "admin") redirect("/painel");
  const { data: flags } = await supabase
    .from("feature_flags")
    .select(
      "flag_key, description, enabled, rollout_percentage, region:marketplace_regions(slug, city, state)",
    )
    .order("flag_key");

  type FlagRow = NonNullable<typeof flags>[number];
  const linhas = (flags ?? [])
    .map((flag) => ({ flag, region: Array.isArray(flag.region) ? flag.region[0] : flag.region }))
    .filter((f): f is { flag: FlagRow; region: NonNullable<FlagRow["region"]> } => !!f.region);
  const produto = linhas.filter((l) => descritor(l.flag.flag_key).categoria === "produto");
  const financeiro = linhas.filter((l) => descritor(l.flag.flag_key).categoria === "financeiro");

  return (
    <main className="container-tight" style={{ padding: "40px 24px 80px" }}>
      <h1 style={{ margin: "0 0 6px" }}>Rollout das experiências</h1>
      <p style={{ color: "var(--ink-soft)", lineHeight: 1.6 }}>
        O mesmo UUID permanece sempre no mesmo grupo. Desativar bloqueia menus, páginas e comandos da
        aplicação para novas jornadas. Atendimentos com execução já iniciada podem ser concluídos. Toda
        alteração exige justificativa e entra no log administrativo.
      </p>
      <div
        role="note"
        style={{
          marginTop: 16,
          padding: 14,
          borderRadius: 10,
          background: "var(--warm-wash)",
          color: "var(--ink-soft)",
          fontSize: 13.5,
          lineHeight: 1.55,
        }}
      >
        Feature flags controlam liberação de produto, não autorização de dados. Reduza percentuais
        gradualmente e acompanhe erros e conversão antes de desativar totalmente.
      </div>

      <h2 style={{ fontSize: "1.1rem", fontWeight: 700, margin: "30px 0 4px" }}>Produto / UX</h2>
      <div style={{ display: "grid", gap: 14, marginTop: 14 }}>
        {produto.map((linha) => <CardFlag key={`${linha.flag.flag_key}-${linha.region.slug}`} {...linha} />)}
      </div>

      <h2 style={{ fontSize: "1.1rem", fontWeight: 700, margin: "38px 0 4px" }}>Financeiro & infraestrutura</h2>
      <div
        role="alert"
        style={{
          marginTop: 10,
          marginBottom: 14,
          padding: 14,
          borderRadius: 10,
          background: "var(--danger-wash)",
          color: "var(--danger)",
          fontSize: 13.5,
          lineHeight: 1.55,
          fontWeight: 600,
        }}
      >
        Estas flags ligam dinheiro real (cobrança de cliente, assinatura de profissional, destaque
        pago) ou trocam o canal de atendimento (Chatwoot). Confirme com o time antes de alterar em
        produção.
      </div>
      <div style={{ display: "grid", gap: 14 }}>
        {financeiro.map((linha) => <CardFlag key={`${linha.flag.flag_key}-${linha.region.slug}`} {...linha} />)}
      </div>
    </main>
  );
}

function CardFlag({ flag, region }: {
  flag: { flag_key: string; description: string; enabled: boolean; rollout_percentage: number };
  region: { slug: string; city: string; state: string };
}) {
  const { label } = descritor(flag.flag_key);
  return (
    <section className="card" style={{ padding: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
        <div>
          <strong>{label}</strong>
          <p style={{ margin: "4px 0 0", color: "var(--ink-faint)", fontSize: 13 }}>
            {flag.description} · {region.city}/{region.state}
          </p>
        </div>
        <span style={{ color: flag.enabled ? "var(--good)" : "var(--danger)", fontSize: 13 }}>
          {flag.enabled ? `${flag.rollout_percentage}%` : "Desativada"}
        </span>
      </div>
      <RolloutForm
        flagKey={flag.flag_key}
        regionSlug={region.slug}
        enabled={flag.enabled}
        rollout={flag.rollout_percentage}
      />
    </section>
  );
}
