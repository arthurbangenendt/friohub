"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { formatarBRL } from "@/lib/pricing";
import { Avatar } from "../../Avatar";
import { Star } from "@/components/icons";
import { perguntasDe } from "@/app/solicitar/perguntas-orcamento";
import type { JobType } from "@/app/solicitar/tipos";
import { formatarDocumento, validarDocumento } from "@/lib/documento";
import { aceitarProposta } from "../actions";
import { ANALYTICS_VERSION, captureAnalytics } from "@/lib/analytics";
import { Campo, CampoSelecao } from "@/components/ui";

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
  /* Só preenchido quando o cliente não sabia o aparelho: o produto que o
     profissional escolheu e o preço que decidiu cobrar por ele. Ver
     20260819100000_pedido_aparelho_conhecido.sql. */
  valor_equipamento: number;
  produtoEscolhido: { marca: string; modelo: string } | null;
};

const dataBR = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString("pt-BR");

/* Comparação de propostas.
 *
 * O total é exibido do mesmo jeito em todas para o cliente conseguir comparar de
 * verdade — mas o preço não vem sozinho: nota, serviços concluídos e o que está
 * fora do escopo aparecem lado a lado. Comparar só por preço é o que leva a rede
 * à corrida para o fundo, e o cliente ao serviço malfeito. */
export function Propostas({
  propostas, podeAceitar, enderecoSugerido, produtoPreco, jobType, detalhesAtuais,
  precisaCpfCnpj = false,
}: {
  propostas: PropostaView[];
  podeAceitar: boolean;
  enderecoSugerido: string;
  produtoPreco: number;
  jobType: JobType;
  detalhesAtuais: Record<string, string>;
  /* true = cobrança real está ligada pra esta região e o cliente ainda não
     tem CPF/CNPJ salvo — precisamos dele pra abrir o customer no Asaas.
     Coleta just-in-time: nunca aparece com a flag desligada. */
  precisaCpfCnpj?: boolean;
}) {
  const router = useRouter();
  const [aceitando, setAceitando] = useState<string | null>(null);
  const [endereco, setEndereco] = useState(enderecoSugerido);
  const [cpfCnpj, setCpfCnpj] = useState("");
  const [respostas, setRespostas] = useState<Record<string, string>>(detalhesAtuais);
  const [erro, setErro] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  /* O questionário técnico só aparece agora, na hora de fechar. Perguntas que a
     triagem já respondeu não entram na lista — ver perguntas-orcamento.ts. */
  const perguntas = perguntasDe(jobType);

  const cpfCnpjDigitos = cpfCnpj.replace(/\D/g, "");
  const cpfCnpjValido = validarDocumento(cpfCnpj);

  function confirmar(quoteId: string) {
    setErro(null);
    if (precisaCpfCnpj && !cpfCnpjValido) {
      setErro("Informe um CPF ou CNPJ válido.");
      return;
    }
    startTransition(async () => {
      const r = await aceitarProposta(quoteId, endereco, respostas, precisaCpfCnpj ? cpfCnpjDigitos : undefined);
      if (!r.ok) return setErro(r.error);
      const escolhida = propostas.find((proposta) => proposta.id === quoteId);
      if (escolhida) captureAnalytics("proposal_comparison_decision", { proposal_count: propostas.length, quote_type: escolhida.tipo, result: "accepted", experience_version: ANALYTICS_VERSION });
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
        /* Em visita técnica, o total exibido é só o que é cobrado agora (a
           visita) — a mão de obra ainda não existe, e o aparelho é uma compra
           à parte, detalhada como linha própria abaixo. Somar o catálogo aqui
           inflava o número e o rótulo "visita técnica" escondia isso.
           `valor_equipamento` só existe quando o cliente não sabia o aparelho —
           nesse caso `produtoPreco` (catálogo) é sempre 0, os dois nunca somam
           juntos. */
        const precoAparelho = produtoPreco > 0 ? produtoPreco : p.valor_equipamento;
        const total = p.tipo === "visita_tecnica" ? servico : servico + precoAparelho;
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
                    : precoAparelho > 0 ? "aparelho + instalação" : "serviço completo"}
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
              {p.tipo === "preco_fechado" ? (
                <>
                  <Linha k="Mão de obra" v={formatarBRL(p.valor_mao_obra)} />
                  {p.valor_materiais > 0 && <Linha k="Materiais" v={formatarBRL(p.valor_materiais)} />}
                  {produtoPreco > 0 && <Linha k="Aparelho (catálogo)" v={formatarBRL(produtoPreco)} />}
                  {p.valor_equipamento > 0 && (
                    <Linha
                      k={p.produtoEscolhido ? `Aparelho (${p.produtoEscolhido.marca} ${p.produtoEscolhido.modelo})` : "Aparelho"}
                      v={formatarBRL(p.valor_equipamento)}
                    />
                  )}
                </>
              ) : (
                <>
                  {produtoPreco > 0 && <Linha k="Aparelho (catálogo, à parte)" v={formatarBRL(produtoPreco)} />}
                  {p.valor_equipamento > 0 && (
                    <Linha
                      k={p.produtoEscolhido ? `Aparelho (${p.produtoEscolhido.marca} ${p.produtoEscolhido.modelo}, à parte)` : "Aparelho (à parte)"}
                      v={formatarBRL(p.valor_equipamento)}
                    />
                  )}
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
              <p style={{ marginTop: 14, marginBottom: 0, color: "var(--good)", fontWeight: 700, fontSize: 14 }}>
                Proposta aceita — o serviço foi criado.
              </p>
            )}

            {podeAceitar && !aceita && p.status === "enviada" && (
              <div style={{ marginTop: 16 }}>
                {aceitando === p.id ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                    {/* O endereço completo só é pedido agora: até aqui o
                        profissional viu apenas o CEP e o bairro. */}
                    <Campo
                      rotulo="Endereço completo do serviço"
                      value={endereco}
                      onChange={(e) => setEndereco(e.target.value)}
                      placeholder="Rua, número, complemento"
                    />

                    {/* CPF/CNPJ só aparece quando a cobrança real está ligada
                        pra esta região e o cliente ainda não tem documento
                        salvo — coleta just-in-time, o Asaas exige isso pra
                        abrir o pagador. */}
                    {precisaCpfCnpj && (
                      <Campo
                        rotulo="CPF ou CNPJ"
                        value={cpfCnpj}
                        onChange={(e) => setCpfCnpj(formatarDocumento(e.target.value))}
                        placeholder="Só números"
                        inputMode="numeric"
                        dica="Necessário para processar o pagamento do serviço pela plataforma."
                      />
                    )}

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
                          q.tipo === "select" ? (
                            <CampoSelecao key={q.id} rotulo={q.label} value={respostas[q.id] ?? ""}
                              onChange={(e) => setRespostas((r) => ({ ...r, [q.id]: e.target.value }))}>
                              <option value="">Selecione…</option>
                              {q.opcoes!.map((o) => <option key={o} value={o}>{o}</option>)}
                            </CampoSelecao>
                          ) : (
                            <Campo key={q.id} rotulo={q.label} value={respostas[q.id] ?? ""}
                              onChange={(e) => setRespostas((r) => ({ ...r, [q.id]: e.target.value }))} />
                          )
                        ))}
                      </div>
                    )}

                    {erro && <p style={{ color: "var(--danger)", fontSize: 13, margin: 0 }}>{erro}</p>}
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
      <span style={{ textAlign: "right", color: destaque ? "var(--danger)" : "var(--ink)" }}>{v}</span>
    </div>
  );
}
