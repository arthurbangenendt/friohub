"use client";

import Link from "next/link";
import { ArrowRight, Bolt, Chat, MapPin } from "@/components/icons";
import { formatarBRL } from "@/lib/pricing";
import { mono } from "./shared";
import { ANALYTICS_VERSION, captureAnalytics } from "@/lib/analytics";

export type AcaoCentral = {
  id: string;
  titulo: string;
  detalhe: string;
  href: string;
  prioridade: "agora" | "hoje" | "acompanhar";
};

export type ProximoAtendimento = {
  jobId: string;
  startsAt: string;
  titulo: string;
  contraparte: string;
  endereco: string;
  valor: number | null;
};

export type ResumoCentral = {
  acoes: AcaoCentral[];
  proximoAtendimento: ProximoAtendimento | null;
  compromissosHoje: number;
  previstoSemana: number;
  mensagensNaoLidas: number;
};

const PRIORIDADE = {
  agora: { label: "Agora", cor: "var(--danger)", bg: "var(--danger-wash)" },
  hoje: { label: "Hoje", cor: "var(--warm)", bg: "var(--warm-wash)" },
  acompanhar: { label: "Acompanhar", cor: "var(--cool-deep)", bg: "var(--cool-wash)" },
};

function hora(iso: string) {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function dia(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "short" });
}

function linkMapa(endereco: string) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(endereco)}`;
}

export function CentralAcoesProfissional({ resumo }: { resumo: ResumoCentral }) {
  const principal = resumo.acoes[0];
  return (
    <section aria-labelledby="meu-dia" style={{ marginTop: 26 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "end", gap: 16, flexWrap: "wrap" }}>
        <div>
          <p style={{ margin: "0 0 5px", color: "var(--cool)", fontFamily: mono, fontSize: 11.5, letterSpacing: ".12em", textTransform: "uppercase" }}>Central de ação</p>
          <h2 id="meu-dia" style={{ margin: 0, fontSize: "1.35rem" }}>Seu dia, em ordem</h2>
        </div>
        <Link href="/painel/agenda" style={{ color: "var(--cool-deep)", fontWeight: 650, fontSize: 13.5 }}>Abrir agenda →</Link>
      </div>

      {principal ? (
        <Link href={principal.href} onClick={() => trackAction(principal, "profissional")} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, marginTop: 14, padding: "20px 22px", borderRadius: 16, background: "var(--cool)", color: "#fff", textDecoration: "none" }}>
          <div>
            <span style={{ fontFamily: mono, fontSize: 11, letterSpacing: ".1em", textTransform: "uppercase", opacity: .78 }}>Próxima melhor ação</span>
            <strong style={{ display: "block", fontSize: 17, marginTop: 5 }}>{principal.titulo}</strong>
            <span style={{ display: "block", fontSize: 13.5, marginTop: 3, opacity: .86 }}>{principal.detalhe}</span>
          </div>
          <ArrowRight size={21} />
        </Link>
      ) : (
        <div className="card" style={{ marginTop: 14, padding: "20px 22px", borderLeft: "3px solid var(--good)" }}>
          <strong>Nada urgente agora.</strong>
          <p style={{ margin: "4px 0 0", color: "var(--ink-soft)", fontSize: 13.5 }}>Sua fila está em dia. Use o tempo livre para revisar oportunidades e perfil.</p>
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 12, marginTop: 12 }}>
        <ProximoCard atendimento={resumo.proximoAtendimento} />
        <div className="card" style={{ padding: 18 }}>
          <strong style={{ fontSize: 14 }}>Resumo rápido</strong>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8, marginTop: 14 }}>
            <MiniKpi label="Hoje" valor={String(resumo.compromissosHoje)} />
            <MiniKpi label="Semana" valor={formatarBRL(resumo.previstoSemana)} />
            <MiniKpi label="Mensagens" valor={String(resumo.mensagensNaoLidas)} />
          </div>
        </div>
      </div>

      {resumo.acoes.length > 1 && (
        <div className="card" style={{ padding: 18, marginTop: 12 }}>
          <strong style={{ fontSize: 14 }}>Também precisa da sua atenção</strong>
          <div style={{ display: "grid", gap: 2, marginTop: 10 }}>
            {resumo.acoes.slice(1, 5).map((acao) => <AcaoLinha key={acao.id} acao={acao} role="profissional" />)}
          </div>
        </div>
      )}
    </section>
  );
}

export function CentralAcoesCliente({ acoes }: { acoes: AcaoCentral[] }) {
  return (
    <section aria-labelledby="proximo-passo" style={{ marginTop: 26 }}>
      <p style={{ margin: "0 0 5px", color: "var(--cool)", fontFamily: mono, fontSize: 11.5, letterSpacing: ".12em", textTransform: "uppercase" }}>Acompanhamento</p>
      <h2 id="proximo-passo" style={{ margin: 0, fontSize: "1.35rem" }}>O que acontece agora</h2>
      <div className="card" style={{ padding: 18, marginTop: 14 }}>
        {acoes.length ? acoes.slice(0, 4).map((acao) => <AcaoLinha key={acao.id} acao={acao} role="cliente" />) : (
          <div style={{ padding: 4 }}>
            <strong>Nenhuma ação pendente.</strong>
            <p style={{ margin: "5px 0 0", color: "var(--ink-soft)", fontSize: 13.5 }}>Quando chegar uma proposta ou confirmação, o próximo passo aparecerá aqui.</p>
          </div>
        )}
      </div>
    </section>
  );
}

function ProximoCard({ atendimento }: { atendimento: ProximoAtendimento | null }) {
  if (!atendimento) return (
    <div className="card" style={{ padding: 18 }}>
      <strong style={{ fontSize: 14 }}>Próximo atendimento</strong>
      <p style={{ margin: "12px 0 14px", color: "var(--ink-soft)", fontSize: 13.5 }}>Nenhuma visita confirmada nos próximos sete dias.</p>
      <Link href="/painel/orcamentos" style={{ color: "var(--cool-deep)", fontWeight: 650, fontSize: 13 }}>Ver oportunidades →</Link>
    </div>
  );
  return (
    <div className="card" style={{ padding: 18, borderLeft: "3px solid var(--cool)" }}>
      <span style={{ color: "var(--ink-faint)", fontSize: 11.5, fontFamily: mono, textTransform: "uppercase" }}>Próximo atendimento</span>
      <strong style={{ display: "block", marginTop: 7 }}>{atendimento.titulo}</strong>
      <span style={{ display: "block", color: "var(--ink-soft)", fontSize: 13, marginTop: 3 }}>{dia(atendimento.startsAt)} às {hora(atendimento.startsAt)} · {atendimento.contraparte}</span>
      {atendimento.valor !== null && <span style={{ display: "block", fontWeight: 700, marginTop: 7 }}>{formatarBRL(atendimento.valor)}</span>}
      <div style={{ display: "flex", gap: 12, marginTop: 14, flexWrap: "wrap" }}>
        <Link href={`/servico/${atendimento.jobId}`} style={{ color: "var(--cool-deep)", fontWeight: 650, fontSize: 13 }}>Abrir serviço</Link>
        <a href={linkMapa(atendimento.endereco)} target="_blank" rel="noopener noreferrer" style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "var(--cool-deep)", fontWeight: 650, fontSize: 13 }}><MapPin size={13} /> Rota</a>
      </div>
    </div>
  );
}

function trackAction(acao: AcaoCentral, role: "cliente" | "profissional") {
  captureAnalytics("dashboard_action_opened", { role, action_type: acao.id.split("-")[0], priority: acao.prioridade, source: "central", experience_version: ANALYTICS_VERSION });
}

function AcaoLinha({ acao, role }: { acao: AcaoCentral; role: "cliente" | "profissional" }) {
  const p = PRIORIDADE[acao.prioridade];
  return (
    <Link href={acao.href} onClick={() => trackAction(acao, role)} style={{ display: "flex", alignItems: "center", gap: 11, padding: "11px 4px", borderBottom: "1px solid var(--line-soft)", color: "inherit", textDecoration: "none" }}>
      <span style={{ display: "grid", placeItems: "center", width: 30, height: 30, flex: "0 0 auto", borderRadius: 9, background: p.bg, color: p.cor }}>{acao.href.includes("mensagens") ? <Chat size={15} /> : <Bolt size={15} />}</span>
      <span style={{ minWidth: 0, flex: 1 }}><strong style={{ display: "block", fontSize: 13.5 }}>{acao.titulo}</strong><span style={{ display: "block", color: "var(--ink-faint)", fontSize: 12.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{acao.detalhe}</span></span>
      <span style={{ fontSize: 10.5, color: p.cor, background: p.bg, padding: "4px 7px", borderRadius: 99 }}>{p.label}</span>
    </Link>
  );
}

function MiniKpi({ label, valor }: { label: string; valor: string }) {
  return <div style={{ minWidth: 0 }}><span style={{ display: "block", color: "var(--ink-faint)", fontSize: 10.5, textTransform: "uppercase" }}>{label}</span><strong style={{ display: "block", marginTop: 4, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{valor}</strong></div>;
}
