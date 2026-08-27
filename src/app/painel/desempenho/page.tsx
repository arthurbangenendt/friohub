import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatarBRL } from "@/lib/pricing";
import { Cabecalho, Kpi, wrap } from "../shared";
import { salvarMeta } from "./actions";
import { featureHabilitada } from "@/lib/feature-flags";
import { Campo } from "@/components/ui";
import { TimelineContent } from "@/components/ui/timeline-animation";
import { Search, Doc, Star, Check, Bolt, Tool } from "@/components/icons";
import { PlanoBloqueado } from "@/components/ui/PlanoBloqueado";

export default async function DesempenhoPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  if (!(await featureHabilitada(supabase, "ux_growth", user.id))) redirect("/painel");
  const { data: p } = await supabase.from("profiles").select("role,avatar_url").eq("id", user.id).single();
  if (p?.role !== "profissional") redirect("/painel");
  const { data: desempenhoLiberado } = await supabase.rpc("plano_permite", {
    p_professional_id: user.id,
    p_feature: "desempenho",
  });
  if (!desempenhoLiberado) {
    return (
      <div style={wrap}>
        <Cabecalho eyebrow="Gestão" titulo="Desempenho" />
        <PlanoBloqueado
          titulo="Desempenho é do plano Profissional"
          descricao="Funil do mês, taxa de conversão e sugestões práticas pra fechar mais orçamento. Faça upgrade para liberar."
        />
      </div>
    );
  }
  const since = new Date();
  since.setDate(1);
  since.setHours(0, 0, 0, 0);
  const [
    { data: targets },
    { data: quotes },
    { data: jobs },
    { data: orders },
    { data: goal },
    { data: pro },
  ] = await Promise.all([
    supabase
      .from("quote_request_targets")
      .select("quote_request_id,visto_em,recusado_em")
      .eq("professional_id", user.id)
      .gte("enviado_em", since.toISOString()),
    supabase
      .from("quotes")
      .select("quote_request_id,status")
      .eq("professional_id", user.id)
      .gte("created_at", since.toISOString()),
    supabase
      .from("jobs")
      .select("id,status")
      .eq("profissional_id", user.id)
      .gte("created_at", since.toISOString()),
    supabase
      .from("orders")
      .select("preco_servico,comissao_servico,payment_status,created_at")
      .gte("created_at", since.toISOString()),
    supabase
      .from("professional_goals")
      .select("revenue_target")
      .eq("professional_id", user.id)
      .eq("month", since.toISOString().slice(0, 7) + "-01")
      .maybeSingle(),
    supabase
      .from("professionals")
      .select("bio,anos_experiencia,banner_url,professional_skills(id),service_areas(id),portfolio_items(id)")
      .eq("id", user.id)
      .maybeSingle(),
  ]);
  const sent = targets?.length ?? 0,
    responses = quotes?.length ?? 0,
    wins = (quotes ?? []).filter((q) => q.status === "aceita").length,
    completed = (jobs ?? []).filter((j) => ["concluido", "avaliado"].includes(j.status)).length;
  const revenue = (orders ?? [])
    .filter((o) => o.payment_status === "pago")
    .reduce((s, o) => s + Number(o.preco_servico) - Number(o.comissao_servico), 0);
  const target = Number(goal?.revenue_target ?? 0);
  const metaPct = target > 0 ? Math.min(100, Math.round((revenue / target) * 100)) : 0;
  const completeness =
    [
      p.avatar_url,
      pro?.banner_url,
      pro?.bio,
      (pro?.anos_experiencia ?? 0) > 0,
      (pro?.professional_skills?.length ?? 0) > 0,
      (pro?.service_areas?.length ?? 0) > 0,
      (pro?.portfolio_items?.length ?? 0) > 0,
    ].filter(Boolean).length / 7;
  const suggestions: string[] = [];
  if (!pro?.bio) suggestions.push("Escreva uma bio objetiva explicando especialidade e diferencial.");
  if (!pro?.portfolio_items?.length) suggestions.push("Adicione fotos reais de antes e depois ao portfólio.");
  if (sent >= 5 && responses / sent < 0.6)
    suggestions.push("Responda oportunidades mais cedo e explique o escopo da proposta.");
  if (responses >= 5 && wins / responses < 0.2)
    suggestions.push("Revise garantia, itens incluídos e clareza da proposta — não apenas o preço.");
  return (
    <div style={wrap}>
      <Cabecalho eyebrow="Gestão" titulo="Desempenho" />
      <p style={{ color: "var(--ink-soft)" }}>
        Funil do mês com o mesmo período em todas as etapas. Sem vaidade e sem denominadores misturados.
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(145px,1fr))", gap: 10 }}>
        <Kpi label="Oportunidades" valor={String(sent)} icone={<Search size={16} />} />
        <Kpi
          label="Propostas"
          valor={String(responses)}
          sufixo={sent ? `${Math.round((responses / sent) * 100)}% das oportunidades` : "sem amostra"}
          icone={<Doc size={16} />}
        />
        <Kpi
          label="Ganhos"
          valor={String(wins)}
          sufixo={responses ? `${Math.round((wins / responses) * 100)}% das propostas` : "sem amostra"}
          icone={<Star size={16} filled />}
        />
        <Kpi label="Concluídos" valor={String(completed)} icone={<Check size={16} />} />
      </div>

      <TimelineContent delay={0}>
        <section className="card" style={{ padding: 22, marginTop: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
            <div className="perfil-skill-icone"><Bolt size={18} /></div>
            <h2 style={{ fontSize: 16.5, fontWeight: 700, margin: 0 }}>Meta do mês</h2>
          </div>

          <strong style={{ fontSize: 24 }}>{formatarBRL(revenue)}</strong>

          {target > 0 && (
            <div style={{ marginTop: 12 }}>
              <div style={{ height: 10, borderRadius: 100, background: "var(--surface-2)", overflow: "hidden" }}>
                <div style={{
                  height: "100%", width: `${metaPct}%`, borderRadius: 100,
                  background: metaPct >= 100 ? "var(--good)" : "var(--cool)",
                  transition: "width .4s ease",
                }} />
              </div>
              <p style={{ fontSize: 13, color: "var(--ink-soft)", margin: "8px 0 0" }}>
                {metaPct}% de {formatarBRL(target)}
              </p>
            </div>
          )}

          <form action={salvarMeta} style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 18, alignItems: "end" }}>
            <input type="hidden" name="month" value={since.toISOString().slice(0, 7)} />
            <div style={{ flex: "1 1 220px" }}>
              <Campo
                rotulo="Meta de receita líquida"
                rotuloOculto
                name="target"
                type="number"
                min="1"
                step="0.01"
                defaultValue={target || undefined}
                placeholder="Meta de receita líquida"
              />
            </div>
            <button className="btn" style={{ height: 44 }}>Salvar meta</button>
          </form>
        </section>
      </TimelineContent>

      <TimelineContent delay={.08}>
        <section className="card" style={{ padding: 22, marginTop: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
            <div className="perfil-skill-icone"><Tool size={18} /></div>
            <h2 style={{ fontSize: 16.5, fontWeight: 700, margin: 0 }}>Assistente de perfil</h2>
          </div>

          <div style={{ marginBottom: 14 }}>
            <div style={{ height: 10, borderRadius: 100, background: "var(--surface-2)", overflow: "hidden" }}>
              <div style={{
                height: "100%", width: `${Math.round(completeness * 100)}%`, borderRadius: 100,
                background: completeness >= 1 ? "var(--good)" : "var(--cool)",
                transition: "width .4s ease",
              }} />
            </div>
            <p style={{ fontSize: 13, color: "var(--ink-soft)", margin: "8px 0 0" }}>
              Completude: <strong>{Math.round(completeness * 100)}%</strong>
            </p>
          </div>

          {suggestions.length ? (
            <ul style={{ display: "flex", flexDirection: "column", gap: 10, margin: "0 0 16px", padding: 0, listStyle: "none" }}>
              {suggestions.map((s) => (
                <li key={s} style={{
                  display: "flex", gap: 10, alignItems: "flex-start", fontSize: 14, color: "var(--ink)",
                  padding: "10px 13px", borderRadius: 10, background: "var(--surface-2)",
                }}>
                  <span style={{ color: "var(--warm)", flexShrink: 0, marginTop: 2 }}><Bolt size={14} /></span>
                  {s}
                </li>
              ))}
            </ul>
          ) : (
            <p style={{ color: "var(--good)" }}>
              Seu perfil cobre os principais sinais de confiança. Continue atualizando trabalhos reais.
            </p>
          )}
          <Link href="/painel/perfil" className="btn">
            Melhorar meu perfil
          </Link>
          <p style={{ fontSize: 12, color: "var(--ink-faint)", marginTop: 14 }}>
            Visualizações de perfil não aparecem porque esse evento ainda não é instrumentado; não exibimos
            estimativas inventadas.
          </p>
        </section>
      </TimelineContent>
    </div>
  );
}
