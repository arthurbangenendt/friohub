import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatarBRL } from "@/lib/pricing";
import { JOB_LABEL } from "@/app/solicitar/tipos";
import type { JobType } from "@/app/solicitar/tipos";
import { Cabecalho, Kpi, wrap, mono } from "../shared";
import { MapPin, Chat, ArrowRight, Bolt, User, Doc } from "@/components/icons";
import {
  LIMITE_DIA,
  diaCurto,
  diasDaSemana,
  duracao,
  hojeISO,
  hora,
  rotuloRelativo,
  rotuloSemana,
  somarDias,
} from "./tempo";
import { Semana, type ItemSemana } from "./Semana";
import { Roteiro, type Parada } from "./Roteiro";
import { PlanoBloqueado } from "@/components/ui/PlanoBloqueado";

/* Agenda do dia do profissional.
 *
 * Esta tela é DE LEITURA. Propor, confirmar e cancelar horário já existe em
 * `/servico/[id]` (ver `Agendamento.tsx` e os RPCs `propor_agendamento` /
 * `responder_agendamento` / `cancelar_agendamento`). Duplicar essas ações aqui
 * criaria dois caminhos para a mesma escrita e duas chances de divergir — a
 * agenda leva o técnico até o serviço e a ação acontece lá.
 *
 * O telefone do cliente NÃO aparece: `profile_private` é self+admin por
 * decisão de produto, e o contato é o chat interno. Ver a política em
 * 20260812120000_profile_private.sql. */

export const metadata = { title: "Agenda — FrioHub" };

type Agendamento = {
  id: string;
  starts_at: string;
  ends_at: string;
  status: string;
  notes: string | null;
  job_id: string;
  jobs: {
    id: string;
    job_type: string;
    cep: string;
    endereco: string | null;
    cidade: string;
    descricao: string | null;
    status: string;
    cliente_id: string;
  } | null;
};

const CEP_FMT = (cep: string) =>
  /^\d{8}$/.test(cep) ? `${cep.slice(0, 5)}-${cep.slice(5)}` : cep;

/** Endereço completo para o app de mapa. Sem endereço de rua, o CEP e a cidade
 *  já levam o técnico à altura certa — melhor que um link quebrado. */
function linkMapa(j: NonNullable<Agendamento["jobs"]>) {
  const partes = [j.endereco, j.cidade, CEP_FMT(j.cep)].filter(Boolean).join(", ");
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(partes)}`;
}

const BADGE: Record<string, { label: string; cor: string; bg: string }> = {
  proposed: { label: "Aguardando confirmação", cor: "var(--warm)", bg: "var(--warm-wash)" },
  confirmed: { label: "Confirmado", cor: "var(--good)", bg: "var(--cool-wash)" },
};

export default async function AgendaPage(props: PageProps<"/painel/agenda">) {
  const sp = await props.searchParams;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  /* A agenda é do lado que executa o serviço. Cliente que chegar aqui volta
     para o painel dele em vez de ver uma tela vazia sem explicação. */
  if (profile?.role !== "profissional") redirect("/painel");

  const { data: agendaLiberada } = await supabase.rpc("plano_permite", {
    p_professional_id: user.id,
    p_feature: "agenda",
  });
  if (!agendaLiberada) {
    return (
      <div style={wrap}>
        <Cabecalho eyebrow="Agenda" titulo="Agenda" />
        <PlanoBloqueado
          titulo="Agenda é do plano Profissional"
          descricao="Veja seus compromissos do dia e da semana num só lugar, com roteiro pronto pra sair de casa. Faça upgrade para liberar."
        />
      </div>
    );
  }

  const hoje = hojeISO();
  const pedido = typeof sp.d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.d) ? sp.d : hoje;
  const visao = sp.v === "semana" ? "semana" : "dia";
  const { inicio, fim } = LIMITE_DIA(pedido);

  /* A visão de semana é uma tela diferente o bastante para ter o próprio
     carregamento de dados: reaproveitar a consulta do dia obrigaria a puxar
     sete dias de detalhe para exibir só horário, tipo e cliente. */
  if (visao === "semana") {
    return <VisaoSemana proId={user.id} dia={pedido} hoje={hoje} />;
  }

  /* Um único round-trip para o dia. `jobs!inner` com filtro em
     `jobs.profissional_id` garante no banco que só vêm agendamentos de serviço
     meu — a RLS de `job_appointments` já limita a participante, e este filtro
     tira o lado cliente. */
  const { data: doDia } = await supabase
    .from("job_appointments")
    .select(
      "id, starts_at, ends_at, status, notes, job_id, jobs!inner(id, job_type, cep, endereco, cidade, descricao, status, cliente_id)",
    )
    .eq("jobs.profissional_id", user.id)
    .neq("status", "cancelled")
    .gte("starts_at", inicio)
    .lte("starts_at", fim)
    .order("starts_at");

  const agenda = (doDia ?? []) as unknown as Agendamento[];

  /* Próximos 14 dias só para a régua de navegação: contagem por dia, sem
     carregar o detalhe de cada um. */
  const { data: futuros } = await supabase
    .from("job_appointments")
    .select("starts_at, jobs!inner(profissional_id)")
    .eq("jobs.profissional_id", user.id)
    .neq("status", "cancelled")
    .gte("starts_at", LIMITE_DIA(hoje).inicio)
    .lte("starts_at", LIMITE_DIA(somarDias(hoje, 13)).fim);

  const porDia = new Map<string, number>();
  for (const f of futuros ?? []) {
    const dia = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(
      new Date(f.starts_at as string),
    );
    porDia.set(dia, (porDia.get(dia) ?? 0) + 1);
  }

  // Nome do cliente e valor do serviço, em lote — nada de consulta por linha.
  const clienteIds = [...new Set(agenda.map((a) => a.jobs?.cliente_id).filter(Boolean))] as string[];
  const jobIds = agenda.map((a) => a.job_id);

  const { data: clientes } = clienteIds.length
    ? await supabase.from("profiles").select("id, nome").in("id", clienteIds)
    : { data: [] };
  const nomePorId = new Map((clientes ?? []).map((c) => [c.id, c.nome]));

  const { data: orders } = jobIds.length
    ? await supabase.from("orders").select("job_id, preco_servico").in("job_id", jobIds)
    : { data: [] };
  const valorPorJob = new Map((orders ?? []).map((o) => [o.job_id, Number(o.preco_servico)]));

  const previsto = agenda.reduce((s, a) => s + (valorPorJob.get(a.job_id) ?? 0), 0);
  const primeiro = agenda[0];

  /* Paradas do roteiro: só o que tem endereço e já está confirmado. Um horário
     ainda "aguardando confirmação" não entra na rota — mandar o técnico para um
     endereço que o cliente não confirmou é pior do que não sugerir rota. */
  const paradas: Parada[] = agenda
    .filter((a) => a.status === "confirmed" && a.jobs)
    .map((a) => ({
      jobId: a.job_id,
      starts_at: a.starts_at,
      endereco: a.jobs!.endereco,
      cidade: a.jobs!.cidade,
      cep: a.jobs!.cep,
      cliente: nomePorId.get(a.jobs!.cliente_id) ?? null,
    }));

  return (
    <div style={wrap}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <Cabecalho eyebrow="Agenda" titulo={rotuloRelativo(pedido)} />
        <AlternadorVisao visao="dia" dia={pedido} />
      </div>

      {/* ---------------- régua de dias ---------------- */}
      <div
        style={{
          display: "flex",
          gap: 6,
          overflowX: "auto",
          padding: "4px 0 14px",
          marginTop: 18,
        }}
      >
        {Array.from({ length: 14 }, (_, i) => somarDias(hoje, i)).map((dia) => {
          const on = dia === pedido;
          const n = porDia.get(dia) ?? 0;
          return (
            <Link
              key={dia}
              href={`/painel/agenda?d=${dia}`}
              style={{
                flex: "0 0 auto",
                display: "grid",
                justifyItems: "center",
                gap: 3,
                minWidth: 62,
                padding: "9px 10px",
                borderRadius: 11,
                textDecoration: "none",
                border: `1px solid ${on ? "var(--cool)" : "var(--line)"}`,
                background: on ? "var(--cool)" : "var(--surface)",
                color: on ? "#fff" : "var(--ink)",
              }}
            >
              <span style={{ fontSize: 10.5, fontFamily: mono, opacity: 0.8, textTransform: "uppercase" }}>
                {dia === hoje ? "hoje" : diaCurto(dia)}
              </span>
              <span style={{ fontSize: 15, fontWeight: 700 }}>{n}</span>
            </Link>
          );
        })}
      </div>

      {/* ---------------- resumo do dia ---------------- */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginTop: 8 }}>
        <Kpi label="Serviços no dia" valor={String(agenda.length)} icone={<Doc size={17} />} />
        <Kpi
          label="Primeiro horário"
          valor={primeiro ? hora(primeiro.starts_at) : "—"}
          icone={<Bolt size={17} />}
        />
        <Kpi label="Previsto no dia" valor={formatarBRL(previsto)} icone={<ArrowRight size={17} />} />
      </div>

      <Roteiro paradas={paradas} />

      {/* ---------------- lista ---------------- */}
      {agenda.length === 0 ? (
        <div
          style={{
            marginTop: 32,
            padding: "44px 28px",
            border: "1px dashed var(--line)",
            borderRadius: 14,
            textAlign: "center",
            background: "var(--surface)",
          }}
        >
          <p style={{ margin: 0, fontWeight: 600, fontSize: 16 }}>Nenhum serviço marcado {rotuloRelativo(pedido).toLowerCase()}.</p>
          <p style={{ margin: "8px auto 20px", color: "var(--ink-soft)", fontSize: 14.5, maxWidth: "46ch", lineHeight: 1.55 }}>
            O horário aparece aqui quando você e o cliente combinam a visita dentro do serviço.
            Enquanto isso, responder orçamento é o que enche a agenda.
          </p>
          <Link href="/painel/orcamentos" className="btn btn-primary">
            Ver orçamentos abertos <ArrowRight size={17} />
          </Link>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 12, marginTop: 30 }}>
          {agenda.map((a) => {
            const j = a.jobs;
            const badge = BADGE[a.status] ?? BADGE.confirmed;
            const valor = valorPorJob.get(a.job_id);
            const nome = j ? nomePorId.get(j.cliente_id) : null;

            return (
              <article
                key={a.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "78px 1fr",
                  gap: 18,
                  padding: "18px 20px",
                  border: "1px solid var(--line)",
                  borderLeft: `3px solid ${a.status === "proposed" ? "var(--warm)" : "var(--cool)"}`,
                  borderRadius: 14,
                  background: "var(--surface)",
                }}
              >
                {/* faixa de horário */}
                <div style={{ borderRight: "1px solid var(--line-soft)", paddingRight: 14 }}>
                  <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums" }}>
                    {hora(a.starts_at)}
                  </div>
                  <div style={{ fontSize: 12, color: "var(--ink-faint)", fontFamily: mono }}>
                    {duracao(a.starts_at, a.ends_at)}
                  </div>
                </div>

                <div style={{ minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 7 }}>
                    <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, letterSpacing: "-0.01em" }}>
                      {j ? (JOB_LABEL[j.job_type as JobType] ?? j.job_type) : "Serviço"}
                    </h3>
                    <span
                      style={{
                        fontSize: 11.5,
                        fontWeight: 700,
                        padding: "3px 9px",
                        borderRadius: 100,
                        color: badge.cor,
                        background: badge.bg,
                      }}
                    >
                      {badge.label}
                    </span>
                    {valor !== undefined && (
                      <span style={{ marginLeft: "auto", fontSize: 15, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                        {formatarBRL(valor)}
                      </span>
                    )}
                  </div>

                  <div style={{ display: "grid", gap: 5, fontSize: 14, color: "var(--ink-soft)" }}>
                    {nome && (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
                        <User size={15} /> {nome}
                      </span>
                    )}
                    {j && (
                      <a
                        href={linkMapa(j)}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ display: "inline-flex", alignItems: "flex-start", gap: 7, color: "var(--cool)", textDecoration: "none" }}
                      >
                        <MapPin size={15} style={{ flex: "0 0 auto", marginTop: 2 }} />
                        <span>
                          {j.endereco ? `${j.endereco} — ` : ""}
                          {j.cidade}, {CEP_FMT(j.cep)}
                        </span>
                      </a>
                    )}
                  </div>

                  {(a.notes || j?.descricao) && (
                    <p
                      style={{
                        margin: "11px 0 0",
                        fontSize: 13.5,
                        lineHeight: 1.55,
                        color: "var(--ink-soft)",
                        background: "var(--surface-2)",
                        borderRadius: 9,
                        padding: "9px 12px",
                      }}
                    >
                      {a.notes || j?.descricao}
                    </p>
                  )}

                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 14 }}>
                    <Link
                      href={`/servico/${a.job_id}`}
                      className="btn btn-ghost"
                      style={{ height: 38, padding: "0 14px", fontSize: 14 }}
                    >
                      Abrir serviço
                    </Link>
                    <Link
                      href="/painel/mensagens"
                      className="btn btn-ghost"
                      style={{ height: 38, padding: "0 14px", fontSize: 14 }}
                    >
                      <Chat size={16} /> Falar com o cliente
                    </Link>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <p style={{ marginTop: 26, fontSize: 13, color: "var(--ink-faint)", lineHeight: 1.6 }}>
        Horários no fuso de {"São Paulo"}. Para propor, confirmar ou cancelar uma visita, abra o
        serviço — é lá que a mudança fica registrada para o cliente também.
      </p>
    </div>
  );
}

/* Alternador dia/semana. Preserva o dia escolhido nas duas direções: quem está
   olhando quinta e troca para semana quer a semana daquela quinta, não a
   semana corrente. */
function AlternadorVisao({ visao, dia }: { visao: "dia" | "semana"; dia: string }) {
  const opcoes = [
    { id: "dia" as const, label: "Dia", href: `/painel/agenda?d=${dia}` },
    { id: "semana" as const, label: "Semana", href: `/painel/agenda?d=${dia}&v=semana` },
  ];
  return (
    <div style={{ display: "flex", gap: 4, padding: 4, borderRadius: 11, background: "var(--surface-2)" }}>
      {opcoes.map((o) => {
        const on = o.id === visao;
        return (
          <Link
            key={o.id}
            href={o.href}
            aria-current={on ? "page" : undefined}
            style={{
              fontSize: 13, fontWeight: 650, padding: "7px 14px", borderRadius: 8,
              background: on ? "var(--surface)" : "transparent",
              color: on ? "var(--ink)" : "var(--ink-soft)",
              boxShadow: on ? "var(--shadow-sm)" : undefined,
            }}
          >
            {o.label}
          </Link>
        );
      })}
    </div>
  );
}

/* Visão de semana.
 *
 * Carrega os sete dias de uma vez com a projeção mínima que a grade precisa —
 * horário, tipo de serviço e nome do cliente. Endereço, valor e observações
 * ficam de fora: são o detalhe que a visão diária mostra, e trazê-los aqui
 * multiplicaria por sete o peso de uma tela cujo propósito é responder "onde
 * tenho espaço nesta semana?". */
async function VisaoSemana({ proId, dia, hoje }: { proId: string; dia: string; hoje: string }) {
  const supabase = await createClient();
  const dias = diasDaSemana(dia);
  const { inicio } = LIMITE_DIA(dias[0]);
  const { fim } = LIMITE_DIA(dias[6]);

  const { data } = await supabase
    .from("job_appointments")
    .select("id, starts_at, status, job_id, jobs!inner(job_type, cliente_id)")
    .eq("jobs.profissional_id", proId)
    .neq("status", "cancelled")
    .gte("starts_at", inicio)
    .lte("starts_at", fim)
    .order("starts_at");

  type Linha = { id: string; starts_at: string; status: string; job_id: string; jobs: { job_type: string; cliente_id: string } | null };
  const linhas = (data ?? []) as unknown as Linha[];

  const clienteIds = [...new Set(linhas.map((l) => l.jobs?.cliente_id).filter(Boolean))] as string[];
  const { data: clientes } = clienteIds.length
    ? await supabase.from("profiles").select("id, nome").in("id", clienteIds)
    : { data: [] };
  const nomePorId = new Map((clientes ?? []).map((c) => [c.id, c.nome]));

  const emSaoPaulo = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" });
  const itens: ItemSemana[] = linhas.map((l) => ({
    id: l.id,
    job_id: l.job_id,
    starts_at: l.starts_at,
    status: l.status,
    job_type: l.jobs?.job_type ?? null,
    cliente: l.jobs ? nomePorId.get(l.jobs.cliente_id) ?? null : null,
    // O dia da coluna é o dia CIVIL de São Paulo, não o dia UTC do instante.
    dia: emSaoPaulo.format(new Date(l.starts_at)),
  }));

  const semanaAtual = dias.includes(hoje);

  return (
    <div style={wrap}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <Cabecalho eyebrow="Agenda" titulo={semanaAtual ? "Esta semana" : rotuloSemana(dia)} />
        <AlternadorVisao visao="semana" dia={dia} />
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 18, flexWrap: "wrap" }}>
        <Link href={`/painel/agenda?d=${somarDias(dias[0], -7)}&v=semana`} className="btn btn-ghost" style={{ height: 36, padding: "0 12px", fontSize: 13.5 }}>
          Semana anterior
        </Link>
        <span style={{ fontSize: 13.5, color: "var(--ink-soft)" }}>{rotuloSemana(dia)}</span>
        <Link href={`/painel/agenda?d=${somarDias(dias[0], 7)}&v=semana`} className="btn btn-ghost" style={{ height: 36, padding: "0 12px", fontSize: 13.5 }}>
          Próxima semana
        </Link>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12, marginTop: 22 }}>
        <Kpi label="Serviços na semana" valor={String(itens.length)} icone={<Doc size={17} />} />
        <Kpi label="Dias com trabalho" valor={String(new Set(itens.map((i) => i.dia)).size)} icone={<Bolt size={17} />} />
        <Kpi label="Dias livres" valor={String(7 - new Set(itens.map((i) => i.dia)).size)} icone={<User size={17} />} />
      </div>

      <Semana dias={dias} itens={itens} />

      <p style={{ marginTop: 26, fontSize: 13, color: "var(--ink-faint)", lineHeight: 1.6 }}>
        Clique num dia para ver endereços, valores e o roteiro. Para propor,
        confirmar ou cancelar uma visita, abra o serviço.
      </p>
    </div>
  );
}
