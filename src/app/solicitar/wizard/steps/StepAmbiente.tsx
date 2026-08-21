import type { calcularBtu } from "@/lib/btu";
import { MAX_AMBIENTES } from "@/app/painel/orcamentos/config";
import { Campo, CartaoAmbiente, H, Nav } from "../shared-components";
import { avisoBox, btnAdicionar, grid2, hint, input } from "../styles";
import { PERIODOS, TIPOS_IMOVEL } from "../constants";
import type { AmbienteForm } from "../types";

export function StepAmbiente({
  tipoImovel, onTipoImovelChange, periodo, onPeriodoChange,
  ambientes, btus, onAlterarAmbiente, onRemoverAmbiente, onAdicionarAmbiente,
  onBack, onNext,
}: {
  tipoImovel: string;
  onTipoImovelChange: (v: string) => void;
  periodo: string;
  onPeriodoChange: (v: string) => void;
  ambientes: AmbienteForm[];
  btus: ReturnType<typeof calcularBtu>[];
  onAlterarAmbiente: (indice: number, mudanca: Partial<AmbienteForm>) => void;
  onRemoverAmbiente: (indice: number) => void;
  onAdicionarAmbiente: () => void;
  onBack: () => void;
  onNext: () => void;
}) {
  return (
    <>
      <H titulo="Quais ambientes você quer climatizar?"
        sub="Pode ser mais de um. Calculamos a capacidade de cada cômodo e você recebe uma proposta pelo conjunto." />

      <div style={{ ...grid2, marginBottom: 8 }}>
        <Campo label="Tipo de imóvel">
          <select value={tipoImovel} onChange={(e) => onTipoImovelChange(e.target.value)} style={input}>
            {TIPOS_IMOVEL.map((t) => <option key={t}>{t}</option>)}
          </select>
        </Campo>
        <Campo label="Uso principal">
          <select value={periodo} onChange={(e) => onPeriodoChange(e.target.value)} style={input}>
            {PERIODOS.map((p) => <option key={p}>{p}</option>)}
          </select>
        </Campo>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {ambientes.map((a, i) => (
          <CartaoAmbiente
            key={a.chave}
            indice={i}
            ambiente={a}
            btu={btus[i]}
            podeRemover={ambientes.length > 1}
            onAlterar={(mudanca) => onAlterarAmbiente(i, mudanca)}
            onRemover={() => onRemoverAmbiente(i)}
          />
        ))}
      </div>

      {ambientes.length < MAX_AMBIENTES ? (
        <button type="button" onClick={onAdicionarAmbiente} style={btnAdicionar}>
          + Adicionar outro ambiente
        </button>
      ) : (
        <p style={{ ...hint, marginTop: 14 }}>
          Limite de {MAX_AMBIENTES} ambientes por pedido atingido.
        </p>
      )}

      {ambientes.length > 1 && (
        <div style={{ ...avisoBox, background: "var(--cool-wash)", color: "var(--cool-deep)" }}>
          <strong>{ambientes.length} ambientes neste pedido.</strong> O profissional atende todos
          numa visita só e responde com um preço pelo pacote — costuma sair mais barato do que
          pedir cada cômodo separado.
        </div>
      )}

      <Nav onBack={onBack} onNext={onNext} nextLabel="Continuar" />
    </>
  );
}
