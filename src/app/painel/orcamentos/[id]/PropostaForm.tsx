"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatarBRL } from "@/lib/pricing";
import { enviarProposta, recusarPedido } from "../actions";
import { CATEGORIA_LABEL } from "@/app/solicitar/tipos";
import type { ProdutoDTO } from "@/app/solicitar/marketplace-types";

const campo: React.CSSProperties = {
  width: "100%", padding: "11px 14px", borderRadius: 11, border: "1px solid var(--line)",
  background: "var(--surface)", fontSize: 14.5, fontFamily: "inherit", color: "var(--ink)",
};
const rotulo: React.CSSProperties = { fontSize: 13, fontWeight: 650, color: "var(--ink-soft)", display: "block", marginBottom: 6 };

const emDias = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

/* Formulário de proposta.
 *
 * Os campos não são decorativos: "o que NÃO está incluso", prazo, garantia e
 * validade são exatamente onde nascem as disputas em serviço de climatização.
 * Deixar isso escrito na proposta é o que evita a discussão depois — e é o que
 * diferencia um orçamento profissional de um número solto no WhatsApp.
 */
export function PropostaForm({
  pedidoId, taxaComissao, sabeAparelho, categoriasDesejadas,
}: {
  pedidoId: string;
  taxaComissao: number;
  /* false = o cliente não sabia o aparelho — este formulário precisa deixar o
     profissional escolher o produto e o preço do equipamento. Se vier true (ou
     não houver categoria pendente), a seção de aparelho nem aparece: o preço
     já é 100% do catálogo e o banco rejeita qualquer tentativa de mexer nisso. */
  sabeAparelho: boolean;
  categoriasDesejadas: string[];
}) {
  const router = useRouter();

  const [tipo, setTipo] = useState<"preco_fechado" | "visita_tecnica">("preco_fechado");
  const [maoObra, setMaoObra] = useState("");
  const [materiais, setMateriais] = useState("");
  const [visita, setVisita] = useState("");
  const [visitaAbatida, setVisitaAbatida] = useState(true);
  const [inclui, setInclui] = useState("");
  const [naoInclui, setNaoInclui] = useState("");
  const [prazo, setPrazo] = useState("");
  const [garantia, setGarantia] = useState("90");
  const [validade, setValidade] = useState(emDias(7));
  const [obs, setObs] = useState("");
  const [recusando, setRecusando] = useState(false);
  const [motivoRecusa, setMotivoRecusa] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const precisaEscolherAparelho = !sabeAparelho && categoriasDesejadas.length > 0;

  // ---- escolha de aparelho (só quando o cliente não sabia o modelo) --------
  const [categoriaFiltro, setCategoriaFiltro] = useState(categoriasDesejadas[0] ?? "");
  const [produtos, setProdutos] = useState<ProdutoDTO[]>([]);
  const [produtosCarregando, setProdutosCarregando] = useState(false);
  const [produtoEscolhido, setProdutoEscolhido] = useState<ProdutoDTO | null>(null);
  const [valorEquipamento, setValorEquipamento] = useState("");

  useEffect(() => {
    if (!precisaEscolherAparelho || !categoriaFiltro) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setProdutosCarregando(true);
      try {
        const r = await fetch(`/api/marketplace/catalogo?kind=produtos&page=1&categoria=${categoriaFiltro}`, { signal: controller.signal });
        const body = await r.json() as { items?: ProdutoDTO[] };
        if (!controller.signal.aborted) setProdutos(body.items ?? []);
      } catch {
        // busca abortada ou catálogo indisponível — a UI já mostra "nenhum aparelho".
      } finally {
        if (!controller.signal.aborted) setProdutosCarregando(false);
      }
    }, 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [precisaEscolherAparelho, categoriaFiltro]);

  const num = (s: string) => Number(s.replace(/\./g, "").replace(",", ".")) || 0;
  const bruto = tipo === "visita_tecnica" ? num(visita) : num(maoObra) + num(materiais);
  const comissao = Math.round(bruto * taxaComissao * 100) / 100;
  const precisaAparelhoAgora = precisaEscolherAparelho && tipo === "preco_fechado";
  const aparelhoIncompleto = precisaAparelhoAgora && (!produtoEscolhido || num(valorEquipamento) <= 0);

  function enviar() {
    setErro(null);
    if (aparelhoIncompleto) {
      setErro("Escolha o aparelho e informe o preço que vai cobrar por ele.");
      return;
    }
    startTransition(async () => {
      const r = await enviarProposta({
        pedidoId,
        tipo,
        valorMaoObra: num(maoObra),
        valorMateriais: num(materiais),
        valorVisita: num(visita),
        visitaAbatida,
        inclui, naoInclui,
        prazoExecucao: prazo,
        garantiaDias: Number(garantia) || 0,
        validadeAte: validade,
        observacoes: obs,
        produtoId: precisaAparelhoAgora ? produtoEscolhido?.id ?? null : null,
        valorEquipamento: precisaAparelhoAgora ? num(valorEquipamento) : 0,
      });
      if (!r.ok) return setErro(r.error);
      router.refresh();
    });
  }

  function recusar() {
    setErro(null);
    if (motivoRecusa.trim().length < 3) {
      setErro("Informe brevemente por que você não vai atender.");
      return;
    }
    startTransition(async () => {
      const r = await recusarPedido(pedidoId, motivoRecusa);
      if (!r.ok) return setErro(r.error);
      router.refresh();
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Preço fechado x visita: em instalação e conserto, nem sempre dá para
          orçar sem ver. Ter a segunda opção evita o chute defensivo. */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
        <Opcao ativo={tipo === "preco_fechado"} onClick={() => setTipo("preco_fechado")}
          titulo="Preço fechado" desc="Consigo orçar com o que foi informado" />
        <Opcao ativo={tipo === "visita_tecnica"} onClick={() => setTipo("visita_tecnica")}
          titulo="Visita técnica" desc="Preciso ver o local antes de fechar" />
      </div>

      {/* Grades com `auto-fit` em vez de duas colunas fixas: este formulário é
          usado majoritariamente no celular, onde `1fr 1fr` espremia os dois
          campos de valor a menos de 160px cada. */}
      {tipo === "preco_fechado" ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
          <label>
            <span style={rotulo}>Mão de obra (R$)</span>
            <input value={maoObra} onChange={(e) => setMaoObra(e.target.value)} inputMode="decimal" placeholder="0,00" style={campo} />
          </label>
          <label>
            <span style={rotulo}>Materiais (R$)</span>
            <input value={materiais} onChange={(e) => setMateriais(e.target.value)} inputMode="decimal" placeholder="0,00" style={campo} />
          </label>
        </div>
      ) : null}

      {/* O cliente não sabia qual aparelho queria — só a categoria. Aqui é o
          profissional quem escolhe o modelo exato na distribuidora e decide o
          preço que vai cobrar por ele (a margem é a diferença entre esse
          valor e o custo real, que a plataforma não revela). */}
      {precisaAparelhoAgora && (
        <div style={{ padding: 15, borderRadius: 12, border: "1px solid var(--line)", background: "var(--surface-2)", display: "grid", gap: 12 }}>
          <span style={{ fontSize: 13.5, fontWeight: 700 }}>
            O cliente não escolheu o aparelho — selecione o modelo e o preço
          </span>
          {categoriasDesejadas.length > 1 && (
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {categoriasDesejadas.map((c) => (
                <button key={c} type="button" onClick={() => { setCategoriaFiltro(c); setProdutoEscolhido(null); }}
                  style={{
                    padding: "6px 12px", borderRadius: 100, fontSize: 12.5, fontWeight: 650, cursor: "pointer",
                    border: `1.5px solid ${categoriaFiltro === c ? "var(--cool)" : "var(--line)"}`,
                    background: categoriaFiltro === c ? "var(--cool-wash)" : "var(--surface)",
                  }}>
                  {CATEGORIA_LABEL[c] ?? c}
                </button>
              ))}
            </div>
          )}
          {produtosCarregando ? (
            <span style={{ fontSize: 13.5, color: "var(--ink-faint)" }}>Carregando aparelhos…</span>
          ) : produtos.length === 0 ? (
            <span style={{ fontSize: 13.5, color: "var(--ink-faint)" }}>Nenhum aparelho disponível nessa categoria.</span>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px,1fr))", gap: 10 }}>
              {produtos.map((p) => {
                const sel = p.id === produtoEscolhido?.id;
                return (
                  <button key={p.id} type="button" onClick={() => setProdutoEscolhido(p)}
                    style={{
                      textAlign: "left", padding: "10px 12px", borderRadius: 10, cursor: "pointer", display: "grid", gap: 3,
                      border: `1.5px solid ${sel ? "var(--cool)" : "var(--line)"}`,
                      background: sel ? "var(--cool-wash)" : "var(--surface)",
                    }}>
                    <span style={{ fontSize: 11, fontWeight: 650, color: "var(--ink-faint)", textTransform: "uppercase" }}>{p.marca}</span>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{p.modelo}</span>
                    <span style={{ fontSize: 11.5, color: "var(--ink-faint)" }}>{p.btu.toLocaleString("pt-BR")} BTU</span>
                    {p.precoVenda !== null && (
                      <span style={{ fontSize: 12, color: "var(--ink-faint)" }}>Referência: {formatarBRL(p.precoVenda)}</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
          <label>
            <span style={rotulo}>Preço do aparelho que você vai cobrar do cliente (R$)</span>
            <input value={valorEquipamento} onChange={(e) => setValorEquipamento(e.target.value)}
              inputMode="decimal" placeholder="0,00" style={campo} disabled={!produtoEscolhido} />
          </label>
        </div>
      )}

      {tipo === "visita_tecnica" && (
        <div style={{ display: "grid", gap: 12 }}>
          <label>
            <span style={rotulo}>Valor da visita (R$)</span>
            <input value={visita} onChange={(e) => setVisita(e.target.value)} inputMode="decimal" placeholder="0,00 (deixe zero se for gratuita)" style={campo} />
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 14, color: "var(--ink-soft)" }}>
            <input type="checkbox" checked={visitaAbatida} onChange={(e) => setVisitaAbatida(e.target.checked)} />
            O valor da visita é abatido se o serviço for fechado comigo
          </label>
        </div>
      )}

      <label>
        <span style={rotulo}>O que está incluso</span>
        <textarea value={inclui} onChange={(e) => setInclui(e.target.value)} rows={2}
          placeholder="Ex.: até 3 m de tubulação, suporte, vácuo, teste de estanqueidade e start-up." style={{ ...campo, resize: "vertical" }} />
      </label>

      <label>
        <span style={rotulo}>O que NÃO está incluso</span>
        <textarea value={naoInclui} onChange={(e) => setNaoInclui(e.target.value)} rows={2}
          placeholder="Ex.: elétrica dedicada, andaime, alvenaria, tubulação acima de 3 m." style={{ ...campo, resize: "vertical" }} />
        <span style={{ fontSize: 12.5, color: "var(--ink-faint)", display: "block", marginTop: 5 }}>
          É aqui que quase toda discussão depois do serviço começa. Vale detalhar.
        </span>
      </label>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
        <label>
          <span style={rotulo}>Prazo de execução</span>
          <input value={prazo} onChange={(e) => setPrazo(e.target.value)} placeholder="Ex.: 1 dia útil" style={campo} />
        </label>
        <label>
          <span style={rotulo}>Garantia (dias)</span>
          <input value={garantia} onChange={(e) => setGarantia(e.target.value)} inputMode="numeric" style={campo} />
        </label>
        <label>
          <span style={rotulo}>Proposta válida até</span>
          <input type="date" value={validade} onChange={(e) => setValidade(e.target.value)} style={campo} />
        </label>
      </div>

      <label>
        <span style={rotulo}>Observações (opcional)</span>
        <textarea value={obs} onChange={(e) => setObs(e.target.value)} rows={2} style={{ ...campo, resize: "vertical" }} />
      </label>

      {/* O profissional vê quanto sobra para ele antes de enviar — nada de
          descobrir a comissão só na hora de receber. */}
      {bruto > 0 && (
        <div style={{ padding: "12px 16px", borderRadius: 12, background: "var(--surface-2)", fontSize: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span style={{ color: "var(--ink-faint)" }}>Valor da proposta</span>
            <span>{formatarBRL(bruto)}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
            <span style={{ color: "var(--ink-faint)" }}>Taxa FrioHub ({Math.round(taxaComissao * 100)}%)</span>
            <span>− {formatarBRL(comissao)}</span>
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, fontWeight: 700 }}>
            <span>Você recebe</span>
            <span>{formatarBRL(bruto - comissao)}</span>
          </div>
          {precisaAparelhoAgora && num(valorEquipamento) > 0 && (
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--line-soft)", fontSize: 13 }}>
              <span style={{ color: "var(--ink-faint)" }}>+ Aparelho (cobrado à parte)</span>
              <span>{formatarBRL(num(valorEquipamento))}</span>
            </div>
          )}
        </div>
      )}

      {recusando && (
        <div style={{ padding: 15, borderRadius: 12, border: "1px solid var(--line)", background: "var(--surface-2)" }}>
          <label>
            <span style={rotulo}>Por que você não vai atender?</span>
            <textarea
              value={motivoRecusa}
              onChange={(event) => setMotivoRecusa(event.target.value)}
              rows={2}
              maxLength={500}
              autoFocus
              placeholder="Ex.: agenda lotada nesta semana."
              style={{ ...campo, resize: "vertical" }}
            />
          </label>
          <div style={{ display: "flex", gap: 9, marginTop: 10 }}>
            <button className="btn" onClick={recusar} disabled={pending}
              style={{ background: "var(--danger-solid)", color: "#fff" }}>
              {pending ? "Registrando…" : "Confirmar recusa"}
            </button>
            <button className="btn" onClick={() => { setRecusando(false); setErro(null); }} disabled={pending}
              style={{ border: "1px solid var(--line)", background: "var(--surface)" }}>
              Voltar
            </button>
          </div>
        </div>
      )}

      {erro && <p style={{ color: "var(--danger)", fontSize: 13.5, margin: 0 }}>{erro}</p>}

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <button className="btn btn-primary" onClick={enviar} disabled={pending || aparelhoIncompleto}>
          {pending ? "Enviando…" : "Enviar proposta"}
        </button>
        <button className="btn" onClick={() => { setRecusando(true); setErro(null); }} disabled={pending || recusando}
          style={{ border: "1px solid var(--line)", background: "var(--surface)" }}>
          Não vou atender
        </button>
      </div>
    </div>
  );
}

function Opcao({ ativo, onClick, titulo, desc }: { ativo: boolean; onClick: () => void; titulo: string; desc: string }) {
  return (
    <button
      onClick={onClick}
      style={{
        textAlign: "left", padding: "13px 15px", borderRadius: 13, cursor: "pointer",
        border: `1.5px solid ${ativo ? "var(--cool)" : "var(--line)"}`,
        background: ativo ? "var(--cool-wash)" : "var(--surface)",
      }}
    >
      <div style={{ fontWeight: 700, fontSize: 14.5 }}>{titulo}</div>
      <div style={{ fontSize: 12.5, color: "var(--ink-faint)", marginTop: 2 }}>{desc}</div>
    </button>
  );
}
