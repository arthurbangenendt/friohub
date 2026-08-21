import Link from "next/link";
import { Building, Check as CheckIcon, MapPin, Search, Star, User } from "@/components/icons";
import { MAX_DESTINATARIOS } from "@/app/painel/orcamentos/config";
import { CIDADE } from "@/lib/regiao";
import { corDoId, iniciais } from "../../../painel/Avatar";
import { Aviso, H, Nav } from "../shared-components";
import { input } from "../styles";
import { SPECIALTY_LABEL } from "../constants";
import type { ProfissionalDTO } from "../../marketplace-types";

type ProOrdenado = ProfissionalDTO & { skill: ProfissionalDTO["skills"][number]; patrocinado: boolean };

export function StepProfissional({
  proBusca, onBuscaChange, proSort, onSortChange, buscaErro,
  profissionaisCarregando, prosOrdenados, profissionaisIds, onToggleProfissional,
  cidadeCep, specialty, profissionaisLista, profissionaisTotal, onCarregarMais,
  disabled, onBack, onNext,
}: {
  proBusca: string;
  onBuscaChange: (v: string) => void;
  proSort: "relevancia" | "nota" | "servicos" | "resposta" | "disponibilidade";
  onSortChange: (v: "relevancia" | "nota" | "servicos" | "resposta" | "disponibilidade") => void;
  buscaErro: string | null;
  profissionaisCarregando: boolean;
  prosOrdenados: ProOrdenado[];
  profissionaisIds: string[];
  onToggleProfissional: (p: ProfissionalDTO) => void;
  cidadeCep: string;
  specialty: string | null;
  profissionaisLista: ProfissionalDTO[];
  profissionaisTotal: number;
  onCarregarMais: () => void;
  disabled: boolean;
  onBack: () => void;
  onNext: () => void;
}) {
  return (
    <>
      <H titulo="Para quem enviar o pedido"
        sub={`Escolha até ${MAX_DESTINATARIOS}. Cada um responde com a própria proposta e você compara antes de decidir.`} />
      <div style={{ display: "flex", gap: 10, marginBottom: 18, flexWrap: "wrap" }}>
        <div style={{ position: "relative", flex: 1, minWidth: 200 }}>
          <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--ink-faint)", display: "flex" }}><Search size={17} /></span>
          <input value={proBusca} onChange={(e) => onBuscaChange(e.target.value)} placeholder="Buscar por nome"
            style={{ ...input, paddingLeft: 38 }} />
        </div>
        <select value={proSort} onChange={(e) => onSortChange(e.target.value as typeof proSort)} style={{ ...input, width: "auto" }}>
          <option value="relevancia">Relevância</option>
          <option value="nota">Melhor avaliados</option>
          <option value="servicos">Mais serviços</option>
          <option value="resposta">Maior taxa de resposta</option>
          <option value="disponibilidade">Menor agenda ativa</option>
        </select>
      </div>

      {buscaErro && <Aviso>{buscaErro}</Aviso>}
      {profissionaisCarregando && prosOrdenados.length === 0 ? (
        <Aviso>Buscando profissionais que atendem o local do serviço…</Aviso>
      ) : prosOrdenados.length === 0 ? (
        <Aviso>Nenhum profissional atende este local{specialty ? ` para “${SPECIALTY_LABEL[specialty]}”` : ""}{proBusca ? " com esse nome" : ""}.</Aviso>
      ) : (
        <div className="pro-grade">
          {prosOrdenados.map((p) => {
            const sel = profissionaisIds.includes(p.id);
            const cheio = !sel && profissionaisIds.length >= MAX_DESTINATARIOS;
            return (
              <div key={p.id} onClick={() => onToggleProfissional(p)} role="button" tabIndex={0}
                aria-pressed={sel}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggleProfissional(p); } }}
                className="pro-card" data-sel={String(sel)}
                style={cheio ? { opacity: 0.45, cursor: "not-allowed" } : undefined}
                title={cheio ? `Você já escolheu ${MAX_DESTINATARIOS} profissionais` : undefined}>

                {/* Retrato: avatar do profissional; sem foto, bloco colorido com iniciais */}
                <div className="pro-capa">
                  {p.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.avatarUrl} alt={p.nome} />
                  ) : (
                    <span className="pro-capa-iniciais" style={{ background: corDoId(p.id) }}>
                      {iniciais(p.nome)}
                    </span>
                  )}
                  {p.patrocinado && <span className="pro-patroc">Patrocinado</span>}
                  {sel && <span className="pro-check"><CheckIcon size={15} /></span>}
                </div>

                <div className="pro-corpo">
                  <span style={{ fontWeight: 700, fontSize: 15, lineHeight: 1.3 }}>{p.nome}</span>

                  <span style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "var(--ink-faint)" }}>
                    {p.tipo === "empresa" ? <Building size={14} /> : <User size={14} />}
                    {p.tipo === "empresa" ? "Empresa" : "Autônomo"}
                    <span>·</span>
                    <MapPin size={13} /> {p.coverageMode === "raio" ? "Dentro do raio de atendimento" : `${cidadeCep || CIDADE} · cobertura por CEP`}
                  </span>

                  <span style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 13 }}>
                    <span style={{ color: "var(--warm)", display: "flex" }}><Star size={14} filled /></span>
                    <strong>{p.skill.ratingAvg.toFixed(1)}</strong>
                    <span style={{ color: "var(--ink-faint)" }}>
                      ({p.skill.ratingCount}) · {p.skill.jobsCompleted} serviços
                    </span>
                  </span>

                  <span style={{ fontSize: 12, color: "var(--ink-faint)" }}>
                    {Math.round(p.responseRate * 100)}% de resposta · {p.activeJobs} serviço(s) ativo(s)
                  </span>

                  {/* Especialidades como chips — o cliente compara de relance */}
                  <span style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 2 }}>
                    {p.skills.slice(0, 3).map((s) => (
                      <span key={s.specialty} className="pro-chip">{SPECIALTY_LABEL[s.specialty] ?? s.specialty}</span>
                    ))}
                  </span>

                  <Link href={`/profissional/${p.id}`} target="_blank" onClick={(e) => e.stopPropagation()}
                    className="pro-link">Acessar perfil →</Link>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {profissionaisLista.length < profissionaisTotal && (
        <button type="button" className="btn" onClick={onCarregarMais} disabled={profissionaisCarregando}
          style={{ marginTop: 16, width: "100%" }}>
          {profissionaisCarregando ? "Carregando…" : `Mostrar mais (${profissionaisLista.length} de ${profissionaisTotal})`}
        </button>
      )}
      {profissionaisIds.length > 0 && (
        <p style={{ fontSize: 13.5, color: "var(--ink-soft)", marginTop: 16 }}>
          {profissionaisIds.length} de {MAX_DESTINATARIOS} selecionados.
        </p>
      )}
      <Nav onBack={onBack} onNext={onNext} nextLabel="Continuar" disabled={disabled} />
    </>
  );
}
