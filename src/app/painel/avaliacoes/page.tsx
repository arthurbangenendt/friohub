import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Kpi, wrap, one, dataCurta } from "../shared";
import { Star } from "@/components/icons";

const SPEC_LABEL: Record<string, string> = {
  instalacao: "Instalação", manutencao: "Manutenção", remanejamento: "Remanejamento",
  limpeza: "Limpeza", conserto: "Conserto",
};

function Estrelas({ nota, size = 15 }: { nota: number; size?: number }) {
  return (
    <span style={{ display: "inline-flex", gap: 2 }}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span key={n} style={{ color: nota >= n - 0.25 ? "var(--warm)" : "var(--ink-faint)", display: "flex" }}>
          <Star size={size} filled={nota >= n - 0.25} />
        </span>
      ))}
    </span>
  );
}

export default async function AvaliacoesPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  // Cliente tem a própria visão de avaliações dentro do perfil dele.
  if (profile?.role !== "profissional") redirect("/painel");

  const { data: skills } = await supabase
    .from("professional_skills")
    .select("specialty, rating_avg, rating_count, jobs_completed")
    .eq("professional_id", user.id);

  const { data: reviews } = await supabase
    .from("reviews")
    .select(`rating, comment, created_at, specialty, cliente:profiles!reviews_cliente_id_fkey ( nome )`)
    .eq("professional_id", user.id)
    .order("created_at", { ascending: false })
    .limit(50);

  const lista = skills ?? [];
  const totalAval = lista.reduce((s, k) => s + (k.rating_count ?? 0), 0);
  const notaGeral = totalAval > 0
    ? lista.reduce((s, k) => s + Number(k.rating_avg ?? 0) * (k.rating_count ?? 0), 0) / totalAval
    : null;
  const totalJobs = lista.reduce((s, k) => s + (k.jobs_completed ?? 0), 0);

  return (
    <div style={wrap}>
      <h1 style={{ fontSize: "1.9rem", fontWeight: 800, letterSpacing: "-0.025em", margin: "0 0 6px" }}>Avaliações</h1>
      <p style={{ color: "var(--ink-soft)", margin: "0 0 28px" }}>
        Sua nota é calculada separadamente por especialidade — é assim que o cliente compara.
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px,1fr))", gap: 12 }}>
        <Kpi label="Nota geral" valor={notaGeral === null ? "—" : notaGeral.toFixed(1)}
          sufixo={notaGeral === null ? "sem avaliações" : `de ${totalAval} avaliaç${totalAval === 1 ? "ão" : "ões"}`}
          icone={notaGeral === null ? undefined : <Star size={15} filled />} />
        <Kpi label="Avaliações recebidas" valor={String(totalAval)} />
        <Kpi label="Serviços concluídos" valor={String(totalJobs)} />
      </div>

      <section className="card" style={{ padding: 24, marginTop: 24 }}>
        <h2 style={{ fontSize: "1.05rem", fontWeight: 700, margin: "0 0 16px" }}>Por especialidade</h2>
        {lista.length === 0 ? (
          <p style={{ color: "var(--ink-faint)", fontSize: 14, margin: 0 }}>
            Nenhuma especialidade cadastrada ainda. Complete seu perfil para aparecer nas buscas.
          </p>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(210px, 1fr))", gap: 12 }}>
            {[...lista].sort((a, b) => Number(b.rating_avg) - Number(a.rating_avg)).map((s) => (
              <div key={s.specialty} style={{ padding: 16, borderRadius: 12, border: "1px solid var(--line)", background: "var(--bg)" }}>
                <strong style={{ fontSize: 14.5 }}>{SPEC_LABEL[s.specialty] ?? s.specialty}</strong>
                <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 8 }}>
                  <Estrelas nota={Number(s.rating_avg)} />
                  <strong style={{ fontSize: 13.5 }}>{Number(s.rating_avg).toFixed(1)}</strong>
                </div>
                <div style={{ fontSize: 12.5, color: "var(--ink-faint)", marginTop: 4 }}>
                  {s.rating_count} avaliaç{s.rating_count === 1 ? "ão" : "ões"} · {s.jobs_completed} serviços
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="card" style={{ padding: 24, marginTop: 16 }}>
        <h2 style={{ fontSize: "1.05rem", fontWeight: 700, margin: "0 0 16px" }}>O que os clientes escreveram</h2>
        {!reviews || reviews.length === 0 ? (
          <p style={{ color: "var(--ink-faint)", fontSize: 14, margin: 0 }}>
            Nenhuma avaliação ainda. Elas aparecem aqui assim que o cliente avaliar um serviço concluído.
          </p>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {reviews.map((r, i) => (
              <div key={i} style={{ paddingBottom: 14, borderBottom: i < reviews.length - 1 ? "1px solid var(--line)" : "none" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <Estrelas nota={r.rating} size={14} />
                  <strong style={{ fontSize: 13.5 }}>{one(r.cliente)?.nome ?? "Cliente"}</strong>
                  <span style={{ fontSize: 12, color: "var(--ink-faint)" }}>
                    {SPEC_LABEL[r.specialty] ?? r.specialty} · {dataCurta(r.created_at)}
                  </span>
                </div>
                {r.comment && <p style={{ margin: "6px 0 0", fontSize: 14, color: "var(--ink-soft)", lineHeight: 1.6 }}>{r.comment}</p>}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
