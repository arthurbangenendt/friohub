import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatarBRL } from "@/lib/pricing";
import { RespostaProposta } from "./RespostaProposta";

/* Propostas de PMOC aguardando o cliente.
 *
 * A RLS de `pmoc_plans` já é por participante, então o filtro por status é só
 * recorte de tela — não é o que protege o dado. */

export const metadata = { title: "Propostas de PMOC — FrioHub" };

const INTERVALO_LABEL: Record<number, string> = {
  1: "mensal",
  2: "bimestral",
  3: "trimestral",
  6: "semestral",
  12: "anual",
};

const dataBR = (d: string) =>
  new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "long" }).format(
    new Date(`${d}T12:00:00-03:00`),
  );

type Proposta = {
  id: string;
  company_name: string;
  site_name: string;
  cidade: string;
  equipment_count: number;
  interval_months: number;
  price_per_visit: number | null;
  next_due_date: string | null;
  notes: string | null;
  professional_id: string | null;
};

export default async function PropostasPmocPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data } = await supabase
    .from("pmoc_plans")
    .select(
      "id, company_name, site_name, cidade, equipment_count, interval_months, price_per_visit, next_due_date, notes, professional_id",
    )
    .eq("client_id", user.id)
    .eq("status", "proposed")
    .order("created_at", { ascending: false });

  const propostas = (data ?? []) as Proposta[];

  const proIds = [...new Set(propostas.map((p) => p.professional_id).filter(Boolean))] as string[];
  const { data: perfis } = proIds.length
    ? await supabase.from("profiles").select("id, nome").in("id", proIds)
    : { data: [] };
  const nomePro = new Map((perfis ?? []).map((p) => [p.id, p.nome]));

  return (
    <main className="container-tight" style={{ padding: "40px 24px 80px" }}>
      <Link href="/painel/pmoc" style={{ color: "var(--ink-faint)", fontSize: 13 }}>
        ← PMOC
      </Link>
      <h1 style={{ margin: "20px 0 6px" }}>Propostas de manutenção</h1>
      <p style={{ color: "var(--ink-soft)", marginBottom: 26, lineHeight: 1.6 }}>
        Contratos de manutenção preventiva propostos por profissionais que já atenderam você.
        Nada é cobrado e nenhuma visita é agendada antes do seu aceite.
      </p>

      {propostas.length === 0 ? (
        <div className="card" style={{ padding: 26 }}>
          <strong style={{ display: "block", marginBottom: 6 }}>Nenhuma proposta pendente.</strong>
          <span style={{ color: "var(--ink-soft)", fontSize: 14, lineHeight: 1.6 }}>
            Você também pode partir do seu lado: peça um PMOC em{" "}
            <Link href="/painel/pmoc" style={{ color: "var(--cool)", fontWeight: 600 }}>
              PMOC
            </Link>{" "}
            e o FrioHub encontra um profissional verificado.
          </span>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 14 }}>
          {propostas.map((p) => {
            const porAno = 12 / p.interval_months;
            const anual = p.price_per_visit ? Number(p.price_per_visit) * porAno : 0;
            return (
              <article key={p.id} className="card" style={{ padding: 22, borderLeft: "4px solid var(--cool)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
                  <div>
                    <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700 }}>{p.company_name}</h2>
                    <p style={{ margin: "3px 0 0", fontSize: 14, color: "var(--ink-soft)" }}>
                      {p.site_name} · {p.cidade}
                    </p>
                  </div>
                  {p.price_per_visit && (
                    <div style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: "-0.02em" }}>
                        {formatarBRL(Number(p.price_per_visit))}
                      </div>
                      <div style={{ fontSize: 12.5, color: "var(--ink-faint)" }}>por visita</div>
                    </div>
                  )}
                </div>

                <dl style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12, margin: "18px 0 0" }}>
                  <Item rotulo="Profissional" valor={nomePro.get(p.professional_id ?? "") ?? "—"} />
                  <Item rotulo="Equipamentos" valor={String(p.equipment_count)} />
                  <Item rotulo="Periodicidade" valor={INTERVALO_LABEL[p.interval_months] ?? `${p.interval_months} meses`} />
                  <Item rotulo="Primeira visita" valor={p.next_due_date ? dataBR(p.next_due_date) : "—"} />
                </dl>

                {anual > 0 && (
                  <p style={{ margin: "16px 0 0", fontSize: 13.5, color: "var(--ink-soft)" }}>
                    São {porAno} visita{porAno > 1 ? "s" : ""} por ano — <strong style={{ color: "var(--ink)" }}>{formatarBRL(anual)}</strong> no total anual.
                  </p>
                )}

                {p.notes && (
                  <p style={{ margin: "12px 0 0", padding: "11px 14px", borderRadius: 10, background: "var(--surface-2)", fontSize: 13.5, lineHeight: 1.6, color: "var(--ink-soft)" }}>
                    {p.notes}
                  </p>
                )}

                <RespostaProposta planId={p.id} />
              </article>
            );
          })}
        </div>
      )}
    </main>
  );
}

function Item({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div>
      <dt style={{ fontSize: 11.5, textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--ink-faint)" }}>
        {rotulo}
      </dt>
      <dd style={{ margin: "3px 0 0", fontSize: 14.5, fontWeight: 600 }}>{valor}</dd>
    </div>
  );
}
