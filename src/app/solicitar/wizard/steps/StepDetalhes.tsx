import { MAX_AMBIENTES } from "@/app/painel/orcamentos/config";
import { Campo, H, Nav } from "../shared-components";
import { btnAdicionar, btnRemover, chip, chipOn, input, labelTxt } from "../styles";
import { PROBLEMAS, URGENCIAS } from "../constants";
import type { AmbienteForm } from "../types";
import type { JobType } from "../../tipos";

export function StepDetalhes({
  jobType, servicoOutro, onServicoOutroChange, ambientes, onAlterarAmbiente,
  onRemoverAmbiente, onAdicionarAmbiente, problemas, onToggleProblema,
  urgencia, onUrgenciaChange, descricao, onDescricaoChange, disabled, onBack, onNext,
}: {
  jobType: JobType | null;
  servicoOutro: string;
  onServicoOutroChange: (v: string) => void;
  ambientes: AmbienteForm[];
  onAlterarAmbiente: (indice: number, mudanca: Partial<AmbienteForm>) => void;
  onRemoverAmbiente: (indice: number) => void;
  onAdicionarAmbiente: () => void;
  problemas: string[];
  onToggleProblema: (p: string) => void;
  urgencia: string;
  onUrgenciaChange: (v: string) => void;
  descricao: string;
  onDescricaoChange: (v: string) => void;
  disabled: boolean;
  onBack: () => void;
  onNext: () => void;
}) {
  return (
    <>
      <H titulo={jobType === "outros" ? "O que você precisa?" : "Conte o que está acontecendo"}
        sub={jobType === "outros" ? "Descreva com suas palavras — encaminhamos ao profissional certo." : "Selecione o que se aplica e descreva com suas palavras."} />

      {jobType === "outros" && (
        <Campo label="Descreva o serviço">
          <textarea value={servicoOutro} onChange={(e) => onServicoOutroChange(e.target.value)}
            placeholder="Ex.: Preciso de um laudo técnico do sistema de climatização da loja."
            rows={4} style={{ ...input, height: "auto", padding: 12, resize: "vertical" }} />
        </Campo>
      )}

      {/* Limpar o ar de três cômodos é UM chamado, não três. Aqui não há
          carga térmica a calcular: basta onde está e quantos aparelhos. */}
      {jobType !== "outros" && (
        <div style={{ marginBottom: 18 }}>
          <span style={labelTxt}>Onde é o serviço?</span>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 8 }}>
            {ambientes.map((a, i) => (
              <div key={a.chave} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  value={a.nome}
                  onChange={(e) => onAlterarAmbiente(i, { nome: e.target.value })}
                  placeholder="Ex.: Quarto do casal"
                  aria-label={`Ambiente ${i + 1}`}
                  style={{ ...input, flex: 1 }}
                />
                <input
                  type="number" min={1} max={20} value={a.quantidade}
                  onChange={(e) => onAlterarAmbiente(i, { quantidade: Math.max(1, Math.min(20, Number(e.target.value) || 1)) })}
                  aria-label={`Aparelhos em ${a.nome || `ambiente ${i + 1}`}`}
                  title="Quantos aparelhos neste ambiente"
                  style={{ ...input, width: 78, flexShrink: 0 }}
                />
                {ambientes.length > 1 && (
                  <button type="button" onClick={() => onRemoverAmbiente(i)}
                    aria-label={`Remover ${a.nome || "ambiente"}`} style={btnRemover}>Remover</button>
                )}
              </div>
            ))}
          </div>
          {ambientes.length < MAX_AMBIENTES && (
            <button type="button" onClick={onAdicionarAmbiente} style={btnAdicionar}>
              + Adicionar outro ambiente
            </button>
          )}
        </div>
      )}

      {jobType && PROBLEMAS[jobType] && (
        <div style={{ marginBottom: 18 }}>
          <span style={labelTxt}>O que está acontecendo?</span>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
            {PROBLEMAS[jobType]!.map((p) => {
              const on = problemas.includes(p);
              return (
                <button key={p} type="button" onClick={() => onToggleProblema(p)}
                  style={{ ...chip, ...(on ? chipOn : {}) }}>{p}</button>
              );
            })}
          </div>
        </div>
      )}

      <div style={{ marginBottom: 18 }}>
        <span style={labelTxt}>Urgência</span>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 8 }}>
          {URGENCIAS.map((u) => (
            <button key={u} type="button" onClick={() => onUrgenciaChange(u)} style={{ ...chip, ...(urgencia === u ? chipOn : {}) }}>{u}</button>
          ))}
        </div>
      </div>

      <Campo label="Detalhes (opcional)">
        <textarea value={descricao} onChange={(e) => onDescricaoChange(e.target.value)} placeholder="Ex.: Split 12k da marca X, tem uns 3 anos, começou a pingar água por dentro."
          rows={4} style={{ ...input, height: "auto", padding: 12, resize: "vertical" }} />
      </Campo>
      <Nav onBack={onBack} onNext={onNext} nextLabel="Escolher profissional" disabled={disabled} />
    </>
  );
}
