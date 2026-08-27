import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatarBRL } from "@/lib/pricing";
import { REGIAO_SLUG } from "@/lib/regiao";
import { Cabecalho, dataCurta, mono, wrap } from "../shared";
import { comoPapel } from "../navegacao";
import { CancelarPmocForm, ConcluirVisitaForm, ResponderPmocForm, SolicitarPmocForm } from "./PmocClient";
import { vincularEquipamentoPmoc } from "./actions";
import { PlanoBloqueado } from "@/components/ui/PlanoBloqueado";

type Visita = {
  id: string;
  due_date: string;
  status: string;
  completion_notes: string | null;
  completed_at: string | null;
};
type Plano = {
  id: string;
  company_name: string;
  site_name: string;
  cep: string;
  equipment_count: number;
  interval_months: number;
  price_per_visit: number | null;
  next_due_date: string | null;
  status: string;
  created_at: string;
  cliente: { nome: string } | { nome: string }[] | null;
  profissional:
    | { profiles: { nome: string } | { nome: string }[] | null }
    | { profiles: { nome: string } | { nome: string }[] | null }[]
    | null;
  pmoc_visits: Visita[];
};

/* `proposed` é o plano que o PROFISSIONAL propôs e espera o cliente — o espelho
   de `offered`, que o admin atribuiu e espera o profissional. Ver
   20260813210000_pmoc_proposto_pelo_profissional.sql. */
const status: Record<string, string> = {
  requested: "Aguardando atribuição",
  proposed: "Aguardando cliente",
  offered: "Aguardando profissional",
  active: "Ativo",
  paused: "Pausado",
  cancelled: "Cancelado",
};
const intervalo: Record<number, string> = {
  1: "mensal",
  2: "bimestral",
  3: "trimestral",
  6: "semestral",
  12: "anual",
};
const one = <T,>(value: T | T[] | null): T | null => (Array.isArray(value) ? (value[0] ?? null) : value);

export default async function PmocPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  const papel = comoPapel(profile?.role);
  if (papel === "distribuidora") redirect("/painel/distribuidora");
  const { data: pmocLiberado } = await supabase.rpc("feature_enabled", {
    p_flag_key: "pmoc",
    p_region_slug: REGIAO_SLUG,
    p_subject_id: user.id,
  });
  if (!pmocLiberado && papel !== "admin") redirect("/painel");

  const { data: pmocPlanoLiberado } =
    papel === "profissional"
      ? await supabase.rpc("plano_permite", { p_professional_id: user.id, p_feature: "pmoc" })
      : { data: null };

  const { data, error } = await supabase
    .from("pmoc_plans")
    .select(
      `id, company_name, site_name, cep, equipment_count, interval_months, price_per_visit, next_due_date, status, created_at, cliente:profiles!pmoc_plans_client_id_fkey(nome), profissional:professionals!pmoc_plans_professional_id_fkey(profiles(nome)), pmoc_visits(id, due_date, status, completion_notes, completed_at)`,
    )
    .order("created_at", { ascending: false });
  const planos = (data ?? []) as unknown as Plano[];
  const { data: equipamentos } =
    papel !== "profissional"
      ? await supabase.from("customer_equipment").select("id, brand, model").eq("customer_id", user.id)
      : { data: [] };
  const { data: vinculos } = await supabase.from("equipment_pmoc_links").select("equipment_id, plan_id");

  return (
    <div style={wrap}>
      <Cabecalho eyebrow="Manutenção recorrente" titulo="PMOC" />
      <p style={{ color: "var(--ink-soft)", maxWidth: 720, lineHeight: 1.6 }}>
        Controle recorrente de manutenção e visitas. Este módulo organiza a operação; pagamento online e
        emissão de documento técnico ainda não estão ativados.
      </p>
      {/* Entradas do fluxo em que o profissional origina o contrato: ele propõe,
        o cliente aceita. O contador só aparece quando há proposta esperando —
        botão que vive mostrando zero vira ruído e o usuário para de olhar. */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 20 }}>
        {papel === "admin" && (
          <Link href="/admin/pmoc" className="btn">
            Abrir fila administrativa
          </Link>
        )}
        {papel === "profissional" && pmocPlanoLiberado && (
          <Link href="/painel/pmoc/propor" className="btn btn-primary">
            Propor PMOC a um cliente
          </Link>
        )}
        {papel !== "profissional" && planos.some((p) => p.status === "proposed") && (
          <Link href="/painel/pmoc/propostas" className="btn btn-primary">
            Propostas recebidas ({planos.filter((p) => p.status === "proposed").length})
          </Link>
        )}
      </div>
      {papel !== "profissional" && (
        <>
          <h2 style={{ marginTop: 26 }}>Solicitar um plano</h2>
          <SolicitarPmocForm />
        </>
      )}
      <h2 style={{ margin: "34px 0 14px" }}>
        {papel === "profissional" ? "Planos atribuídos a você" : "Seus planos"}
      </h2>
      {papel === "profissional" && !pmocPlanoLiberado ? (
        <PlanoBloqueado
          titulo="PMOC é do plano Essencial"
          descricao="Receba e acompanhe contratos de manutenção recorrente atribuídos a você, com visitas geradas automaticamente. Faça upgrade para liberar."
        />
      ) : (
        <>
          {error && <p style={{ color: "var(--danger)" }}>Não foi possível carregar os planos.</p>}
          {!error && planos.length === 0 && (
            <div className="card" style={{ padding: 24, color: "var(--ink-faint)" }}>
              Nenhum plano PMOC por aqui.
            </div>
          )}
          <div style={{ display: "grid", gap: 12 }}>
            {planos.map((plano) => (
              <PlanoCard
                key={plano.id}
                plano={plano}
                isPro={papel === "profissional"}
                equipamentos={equipamentos ?? []}
                vinculados={(vinculos ?? []).filter((v) => v.plan_id === plano.id).map((v) => v.equipment_id)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function PlanoCard({
  plano,
  isPro,
  equipamentos,
  vinculados,
}: {
  plano: Plano;
  isPro: boolean;
  equipamentos: { id: string; brand: string | null; model: string | null }[];
  vinculados: string[];
}) {
  const cliente = one(plano.cliente);
  const pro = one(plano.profissional);
  const perfilPro = pro ? one(pro.profiles) : null;
  const visitas = [...(plano.pmoc_visits ?? [])].sort((a, b) => a.due_date.localeCompare(b.due_date));
  return (
    <article className="card" style={{ padding: 20 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <strong style={{ fontSize: 17 }}>
            {plano.company_name} · {plano.site_name}
          </strong>
          <div style={{ color: "var(--ink-faint)", fontSize: 13, marginTop: 4 }}>
            {plano.equipment_count} equipamento(s) · {intervalo[plano.interval_months]} · CEP {plano.cep}
          </div>
        </div>
        <span
          style={{
            fontFamily: mono,
            fontSize: 12,
            padding: "5px 10px",
            borderRadius: 99,
            background: "var(--surface-2)",
          }}
        >
          {status[plano.status] ?? plano.status}
        </span>
      </div>
      <p style={{ fontSize: 13.5, color: "var(--ink-soft)" }}>
        {isPro ? `Cliente: ${cliente?.nome ?? "Cliente"}` : `Profissional: ${perfilPro?.nome ?? "a definir"}`}
        {plano.price_per_visit ? ` · ${formatarBRL(plano.price_per_visit)} por visita` : ""}
      </p>
      {isPro && plano.status === "offered" && <ResponderPmocForm planoId={plano.id} />}
      {!isPro && equipamentos.length > 0 && (
        <form
          action={vincularEquipamentoPmoc}
          style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "12px 0" }}
        >
          <input type="hidden" name="planoId" value={plano.id} />
          <select
            name="equipamentoId"
            defaultValue=""
            required
            style={{ padding: 8, border: "1px solid var(--line)", borderRadius: 8 }}
          >
            <option value="" disabled>
              Vincular equipamento
            </option>
            {equipamentos
              .filter((e) => !vinculados.includes(e.id))
              .map((e) => (
                <option key={e.id} value={e.id}>
                  {[e.brand, e.model].filter(Boolean).join(" ") || "Equipamento"}
                </option>
              ))}
          </select>
          <button className="btn">Vincular ao PMOC</button>
        </form>
      )}
      {visitas.length > 0 && (
        <div style={{ borderTop: "1px solid var(--line)", marginTop: 15, paddingTop: 13 }}>
          <strong style={{ fontSize: 13.5 }}>Visitas</strong>
          {visitas.map((v) => (
            <div key={v.id} style={{ padding: "10px 0", borderBottom: "1px solid var(--line)" }}>
              <div style={{ fontSize: 13 }}>
                Prevista para {dataCurta(`${v.due_date}T12:00:00`)} ·{" "}
                {v.status === "completed" ? "Concluída" : v.status === "planned" ? "Pendente" : "Cancelada"}
              </div>
              {v.completion_notes && (
                <p style={{ fontSize: 13, color: "var(--ink-soft)" }}>{v.completion_notes}</p>
              )}
              {isPro && v.status === "planned" && <ConcluirVisitaForm visitaId={v.id} />}
            </div>
          ))}
        </div>
      )}
      {!isPro && plano.status !== "cancelled" && (
        <div style={{ marginTop: 14 }}>
          <CancelarPmocForm planoId={plano.id} />
        </div>
      )}
    </article>
  );
}
