"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { formatarBRL } from "@/lib/pricing";
import { Avatar } from "../../Avatar";
import { Star } from "@/components/icons";
import { perguntasDe } from "@/app/solicitar/perguntas-orcamento";
import type { JobType } from "@/app/solicitar/tipos";
import { aceitarProposta } from "../actions";

export type PropostaView = {
  id: string;
  professional_id: string;
  tipo: "preco_fechado" | "visita_tecnica";
  valor_mao_obra: number;
  valor_materiais: number;
  valor_visita: number;
  visita_abatida: boolean;
  inclui: string | null;
  nao_inclui: string | null;
  prazo_execucao: string | null;
  garantia_dias: number;
  validade_ate: string;
  observacoes: string | null;
  status: string;
  nome: string;
  avatarUrl: string | null;
  nota: number | null;
  servicos: number;
};

const dataBR = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString("pt-BR");

const campoAceite: React.CSSProperties = {
  width: "100%", marginTop: 6, padding: "11px 14px", borderRadius: 11,
  border: "1px solid var(--line)", background: "var(--surface)",
  fontSize: 14.5, fontFamily: "inherit", color: "var(--ink)",
};

/* Comparação de propostas.
 *
 * O total é exibido do mesmo jeito em todas para o cliente conseguir comparar de
 * verdade — mas o preço não vem sozinho: nota, serviços concluídos e o que está
 * fora do escopo aparecem lado a lado. Comparar só por preço é o que leva a rede
 * à corrida para o fundo, e o cliente ao serviço malfeito. */
export function Propostas({
  propostas, podeAceitar, enderecoSugerido, produtoPreco, jobType, detalhesAtuais,
}: {
  propostas: PropostaView[];
  podeAceitar: boolean;
  enderecoSugerido: string;
  produtoPreco: number;
  jobType: JobType;
  detalhesAtuais: Record<string, string>;
}) {
  const router = useRouter();
  const [aceitando, setAceitando] = useState<string | null>(null);
  const [endereco, setEndereco] = useState(enderecoSugerido);
  const [respostas, setRespostas] = useState<Record<string, string>>(detalhesAtuais);
  const [erro, setErro] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  /* O questionário técnico só aparece agora, na hora de fechar. Perguntas que a
     triagem já respondeu não entram na lista — ver perguntas-orcamento.ts. */
  const perguntas = perguntasDe(jobType);

  function confirmar(quoteId: string) {
    setErro(null);
    startTransition(async () => {
      const r = await aceitarProposta(quoteId, endereco, respostas);
      if (!r.ok) return setErro(r.error);
      router.push(`/servico/${r.jobId}`);
    });
  }

  if (propostas.length === 0) {
    return (
      <div style={{ padding: 26, borderRadius: 14, border: "1px dashed var(--line)", color: "var(--ink-faint)", fontSize: 14.5, textAlign: "center" }}>
        Nenhuma proposta ainda. Os profissionais foram avisados e respondem por aqui.
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {propostas.map((p) => {
        const servico = p.tipo === "visita_tecnica" ? p.valor_visita : p.valor_mao_obra + p.valor_materiais;
        const total = servico + produtoPreco;
        const vencida = new Date(`${p.validade_ate}T23:59:59`) < new Date();
        const aceita = p.status === "aceita";

        return (
          <div key={p.id} className="card" style={{ padding: 20, opacity: p.status === "recusada" ? 0.55 : 1 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
              <Avatar nome={p.nome} id={p.professional_id} url={p.avatarUrl} size={44} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <Link href={`/profissional/${p.professional_id}`} style={{ fontWeight: 700, fontSize: 15.5, color: "inherit" }}>
                  {p.nome}
                </Link>
                <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "var(--ink-faint)", marginTop: 2 }}>
                  {p.nota !== null ? (
                    <>
                      <span style={{ color: "var(--warm)", display: "flex" }}><Star size={13} filled /></span>
                      <strong style={{ color: "var(--ink)" }}>{p.nota.toFixed(1)}</strong>
                      <span>· {p.servicos} serviços</span>
                    </>
                  ) : (
                    <span>Sem avaliações ainda</span>
                  )}
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: "1.35rem", fontWeight: 800, letterSpacing: "-0.02em" }}>{formatarBRL(total)}</div>
                <div style={{ fontSize: 12, color: "var(--ink-faint)" }}>
                  {p.tipo === "visita_tecnica"
                    ? (p.valor_visita === 0 ? "visita gratuita" : "visita técnica")
                    : produtoPreco > 0 ? "aparelho + instalação" : "serviço completo"}
                </div>
              </div>
            </div>

            {p.tipo === "visita_tecnica" && (
              <p style={{ fontSize: 13.5, color: "var(--ink-soft)", background: "var(--warm-wash)", padding: "10px 13px", borderRadius: 10, margin: "0 0 12px" }}>
                Este profissional precisa ver o local antes de fechar o preço.
                {p.visita_abatida && p.valor_visita > 0 && " O valor da visita é abatido se você fechar com ele."}
              </p>
            )}

            <div style={{ display: "grid", gap: 8, fontSize: 14 }}>
              {p.tipo === "preco_fechado" && (
                <>
                  <Linha k="Mão de obra" v={formatarBRL(p.valor_mao_obra)} />
                  {p.valor_materiais > 0 && <Linha k="Materiais" v={formatarBRL(p.valor_materiais)} />}
                  {produtoPreco > 0 && <Linha k="Aparelho (catálogo)" v={formatarBRL(produtoPreco)} />}
                </>
              )}
              {p.inclui && <Linha k="Inclui" v={p.inclui} />}
              {p.nao_inclui && <Linha k="Não inclui" v={p.nao_inclui} destaque />}
              {p.prazo_execucao && <Linha k="Prazo" v={p.prazo_execucao} />}
              <Linha k="Garantia" v={`${p.garantia_dias} dias`} />
              <Linha k="Válida até" v={dataBR(p.validade_ate)} />
              {p.observacoes && <Linha k="Observações" v={p.observacoes} />}
            </div>

            {aceita && (
              <p style={{ marginTop: 14, marginBottom: 0, color: "#2E8B6F", fontWeight: 700, fontSize: 14 }}>
                Proposta aceita — o serviço foi criado.
              </p>
            )}

            {podeAceitar && !aceita && p.status === "enviada" && (
              <div style={{ marginTop: 16 }}>
                {aceitando === p.id ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                    {/* O endereço completo só é pedido agora: até aqui o
                        profissional viu apenas o CEP e o bairro. */}
                    <label style={{ fontSize: 13, fontWeight: 650, color: "var(--ink-soft)" }}>
                      Endereço completo do serviço
                      <input
                        value={endereco}
                        onChange={(e) => setEndereco(e.target.value)}
                        placeholder="Rua, número, complemento"
                        style={campoAceite}
                      />
                    </label>

                    {/* Questionário técnico: só nesta hora. No pedido inicial
                        seria atrito antes de existir alguém interessado; aqui é
                        o que o profissional precisa para executar sem surpresa. */}
                    {perguntas.length > 0 && (
                      <div style={{ display: "flex", flexDirection: "column", gap: 12, paddingTop: 4 }}>
                        <span style={{ fontSize: 13.5, color: "var(--ink-soft)" }}>
                          Últimos detalhes para {p.nome} chegar preparado. Se não souber alguma coisa,
                          deixe em branco — ele confirma na hora.
                        </span>
                        {perguntas.map((q) => (
                          <label key={q.id} style={{ fontSize: 13, fontWeight: 650, color: "var(--ink-soft)" }}>
                            {q.label}
                            {q.tipo === "select" ? (
                              <select value={respostas[q.id] ?? ""} style={campoAceite}
                                onChange={(e) => setRespostas((r) => ({ ...r, [q.id]: e.target.value }))}>
                                <option value="">Selecione…</option>
                                {q.opcoes!.map((o) => <option key={o} value={o}>{o}</option>)}
                              </select>
                            ) : (
                              <input value={respostas[q.id] ?? ""} style={campoAceite}
                                onChange={(e) => setRespostas((r) => ({ ...r, [q.id]: e.target.value }))} />
                            )}
                          </label>
                        ))}
                      </div>
                    )}

                    {erro && <p style={{ color: "#b3261e", fontSize: 13, margin: 0 }}>{erro}</p>}
                    <div style={{ display: "flex", gap: 10 }}>
                      <button className="btn btn-primary" onClick={() => confirmar(p.id)} disabled={pending}>
                        {pending ? "Confirmando…" : "Confirmar contratação"}
                      </button>
                      <button className="btn" onClick={() => setAceitando(null)} disabled={pending}
                        style={{ border: "1px solid var(--line)", background: "var(--surface)" }}>
                        Voltar
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    className="btn btn-primary"
                    onClick={() => setAceitando(p.id)}
                    disabled={vencida}
                    title={vencida ? "Esta proposta venceu" : undefined}
                  >
                    {vencida ? "Proposta vencida" : "Aceitar esta proposta"}
                  </button>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Linha({ k, v, destaque }: { k: string; v: string; destaque?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 16, paddingBottom: 8, borderBottom: "1px solid var(--line-soft)" }}>
      <span style={{ color: "var(--ink-faint)", flexShrink: 0 }}>{k}</span>
      <span style={{ textAlign: "right", color: destaque ? "#b3261e" : "var(--ink)" }}>{v}</span>
    </div>
  );
}
