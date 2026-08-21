import type { calcularBtu } from "@/lib/btu";
import { formatarBtu } from "@/lib/btu";
import { formatarBRL } from "@/lib/pricing";
import { Aviso, H, LinhaResumo } from "../shared-components";
import { btnGhost, btnPrimary, chip, chipOn, labelTxt, linkBtn, resumo } from "../styles";
import { JOBS, URGENCIAS } from "../constants";
import { FotosPedido, type FotoPendente } from "../../FotosPedido";
import type { AmbienteForm } from "../types";
import type { JobType } from "../../tipos";

export function StepConfirmar({
  comCatalogo, urgencia, onUrgenciaChange, userId, fotos, onFotosChange,
  jobType, servicoOutro, nomesProfissionaisSelecionados, tipoImovel, periodo,
  totalAparelhos, ambientes, btus, jaTemEquipamento, sabeAparelho, problemas,
  bairro, cep, descricao, totalProdutosEscolhidos, temStepCarrinho, onIrParaCarrinho,
  estimativaInstalacao, erro, onBack, onConfirmar, pending, quantidadeProfissionais,
}: {
  comCatalogo: boolean;
  urgencia: string;
  onUrgenciaChange: (v: string) => void;
  userId: string;
  fotos: FotoPendente[];
  onFotosChange: (fotos: FotoPendente[]) => void;
  jobType: JobType | null;
  servicoOutro: string;
  nomesProfissionaisSelecionados: string;
  tipoImovel: string;
  periodo: string;
  totalAparelhos: number;
  ambientes: AmbienteForm[];
  btus: ReturnType<typeof calcularBtu>[];
  jaTemEquipamento: boolean | null;
  sabeAparelho: boolean | null;
  problemas: string[];
  bairro: string;
  cep: string;
  descricao: string;
  totalProdutosEscolhidos: number;
  temStepCarrinho: boolean;
  onIrParaCarrinho: () => void;
  estimativaInstalacao: number;
  erro: string | null;
  onBack: () => void;
  onConfirmar: () => void;
  pending: boolean;
  quantidadeProfissionais: number;
}) {
  return (
    <>
      <H titulo="Confirme o pedido de orçamento" sub="Revise antes de enviar. Você não se compromete com nada agora." />

      {/* "Quantos aparelhos" saiu daqui: a quantidade agora vem de cada
          ambiente, então perguntar de novo seria pedir a mesma informação
          duas vezes — e deixar as duas respostas divergirem. */}

      {comCatalogo && (
        <div style={{ marginBottom: 18 }}>
          <span style={labelTxt}>Urgência</span>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
            {URGENCIAS.map((u) => (
              <button key={u} type="button" onClick={() => onUrgenciaChange(u)} style={{ ...chip, ...(urgencia === u ? chipOn : {}) }}>{u}</button>
            ))}
          </div>
        </div>
      )}

      <FotosPedido userId={userId} fotos={fotos} onChange={onFotosChange} />

      <div style={{ ...resumo, marginTop: 20 }}>
        <LinhaResumo k="Serviço" v={JOBS.find((j) => j.tipo === jobType)!.titulo} />
        {jobType === "outros" && servicoOutro && <LinhaResumo k="Descrição" v={servicoOutro} />}
        <LinhaResumo k="Enviar para" v={nomesProfissionaisSelecionados || "-"} />
        {comCatalogo && <LinhaResumo k="Imóvel" v={`${tipoImovel} · Uso: ${periodo}`} />}
        {totalAparelhos > 1 && <LinhaResumo k="Total de aparelhos" v={`${totalAparelhos}`} />}

        {/* Uma linha por ambiente: é o escopo que o profissional vai orçar,
            e é aqui que o cliente confere antes de disparar. */}
        <LinhaResumo
          k={ambientes.length > 1 ? `Ambientes (${ambientes.length})` : "Ambiente"}
          v={
            <span style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {ambientes.map((a, i) => (
                <span key={a.chave}>
                  <strong>{a.nome || `Ambiente ${i + 1}`}</strong>
                  {a.quantidade > 1 ? ` · ${a.quantidade} aparelhos` : ""}
                  {comCatalogo ? ` · ${a.areaM2} m² · ${formatarBtu(btus[i].btuRecomendado)}` : ""}
                  {a.produto ? ` · ${a.produto.modelo}` : ""}
                </span>
              ))}
            </span>
          }
        />
        {comCatalogo && jaTemEquipamento === true && <LinhaResumo k="Aparelho" v="Cliente já possui" />}
        {comCatalogo && sabeAparelho === false && (
          <LinhaResumo k="Aparelho" v="Sem preço fechado — o profissional escolhe o modelo e propõe o valor" />
        )}
        {!comCatalogo && problemas.length > 0 && <LinhaResumo k="Problemas" v={problemas.join(", ")} />}
        {urgencia && <LinhaResumo k="Urgência" v={urgencia} />}
        <LinhaResumo k="Região" v={`${bairro ? `${bairro} · ` : ""}${cep}`} />
        {fotos.length > 0 && <LinhaResumo k="Fotos" v={`${fotos.length} enviada${fotos.length > 1 ? "s" : ""}`} />}
        {descricao && <LinhaResumo k="Detalhes" v={descricao} />}

        <div style={{ borderTop: "1px solid var(--line)", margin: "8px 0", paddingTop: 10 }} />
        {/* O aparelho tem preço de catálogo; a mão de obra vem da proposta de
            cada profissional. Mostrar "total" aqui seria inventar número. */}
        {totalProdutosEscolhidos > 0 && (
          <LinhaResumo
            k={ambientes.length > 1 ? "Aparelhos (catálogo)" : "Aparelho (catálogo)"}
            v={
              temStepCarrinho ? (
                <button type="button" onClick={onIrParaCarrinho} style={{ ...linkBtn, fontSize: 14.5, color: "var(--ink)" }}>
                  {formatarBRL(totalProdutosEscolhidos)} · ver carrinho
                </button>
              ) : formatarBRL(totalProdutosEscolhidos)
            }
          />
        )}
        {comCatalogo && (
          <LinhaResumo k="Instalação (estimativa)" v={`a partir de ${formatarBRL(estimativaInstalacao)}`} />
        )}
        <LinhaResumo
          k={<strong>Mão de obra</strong>}
          v={<strong>definida na proposta de cada profissional</strong>}
        />
      </div>
      {erro && <Aviso erro>{erro}</Aviso>}
      <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
        <button onClick={onBack} style={btnGhost} disabled={pending}>Voltar</button>
        <button onClick={onConfirmar} style={{ ...btnPrimary, flex: 1, opacity: pending ? 0.7 : 1 }} disabled={pending}>
          {pending
            ? "Enviando..."
            : `Pedir orçamento a ${quantidadeProfissionais} profissiona${quantidadeProfissionais === 1 ? "l" : "is"}`}
        </button>
      </div>
    </>
  );
}
