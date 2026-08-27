import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { featureHabilitada } from "@/lib/feature-flags";
import { Cabecalho, wrap } from "../shared";
import { PlanoBloqueado } from "@/components/ui/PlanoBloqueado";
import { EmptyState } from "@/components/ui/EmptyState";
import { AssistenteChat } from "./AssistenteChat";
import { listarConversas } from "./actions";

export default async function AssistentePage({
  searchParams,
}: {
  searchParams: Promise<{ orcamento?: string }>;
}) {
  const { orcamento } = await searchParams;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "profissional") redirect("/painel");

  // Duas camadas: plano decide QUEM pode usar (Master), a flag decide SE a
  // feature está no ar agora — kill switch independente do plano.
  const [{ data: liberadoPeloPlano }, ligada] = await Promise.all([
    supabase.rpc("plano_permite", { p_professional_id: user.id, p_feature: "assistente" }),
    featureHabilitada(supabase, "assistente_ia", user.id),
  ]);

  // As duas mensagens não podem se misturar: dizer "faça upgrade" para quem já
  // está no Master (só a flag está desligada) é enganoso — e ao contrário,
  // convidar quem não é Master a "esperar a liberação" esconderia que o
  // caminho certo é o upgrade.
  if (!liberadoPeloPlano) {
    return (
      <div style={wrap}>
        <Cabecalho eyebrow="Apoio técnico" titulo="Assistente IA" />
        <div style={{ marginTop: 24 }}>
          <PlanoBloqueado
            titulo="Assistente IA é do plano Master"
            descricao="Dimensionamento de BTU, diagnóstico técnico e rascunho de orçamento a partir do pedido do cliente. Faça upgrade para liberar."
          />
        </div>
      </div>
    );
  }
  if (!ligada) {
    return (
      <div style={wrap}>
        <Cabecalho eyebrow="Apoio técnico" titulo="Assistente IA" />
        <div style={{ marginTop: 24 }}>
          <EmptyState
            titulo="Assistente IA ainda não está disponível"
            descricao="Estamos liberando aos poucos. Volte em breve."
          />
        </div>
      </div>
    );
  }

  const resultado = await listarConversas();
  const conversas = resultado.ok ? resultado.conversas : [];

  return (
    <div style={wrap}>
      <Cabecalho eyebrow="Apoio técnico" titulo="Assistente IA" />
      <p style={{ color: "var(--ink-soft)", margin: "10px 0 28px" }}>
        Tire dúvidas de instalação, manutenção e diagnóstico, ou peça uma análise de um orçamento recebido.
      </p>
      <AssistenteChat conversasIniciais={conversas} orcamentoParaAbrir={orcamento ?? null} />
    </div>
  );
}
