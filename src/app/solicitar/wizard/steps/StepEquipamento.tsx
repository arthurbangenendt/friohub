import type { calcularBtu } from "@/lib/btu";
import { formatarBtu } from "@/lib/btu";
import { Campo, EscolhaGrande, H, Nav } from "../shared-components";
import { avisoBox, input } from "../styles";

export function StepEquipamento({
  jaTemEquipamento, onEscolher, descricao, onDescricaoChange, btu, disabled, onBack, onNext,
}: {
  jaTemEquipamento: boolean | null;
  onEscolher: (v: boolean) => void;
  descricao: string;
  onDescricaoChange: (v: string) => void;
  btu: ReturnType<typeof calcularBtu>;
  disabled: boolean;
  onBack: () => void;
  onNext: () => void;
}) {
  return (
    <>
      <H titulo="Você já tem o aparelho?" sub="Se ainda não tiver, mostramos as opções das distribuidoras parceiras." />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px,1fr))", gap: 12 }}>
        <EscolhaGrande
          titulo="Já tenho o aparelho"
          desc="Só preciso do serviço de instalação."
          ativo={jaTemEquipamento === true}
          onClick={() => onEscolher(true)}
        />
        <EscolhaGrande
          titulo="Ainda não tenho"
          desc="Quero ver aparelhos e comparar preços."
          ativo={jaTemEquipamento === false}
          onClick={() => onEscolher(false)}
        />
      </div>
      {jaTemEquipamento === true && (
        <div style={{ marginTop: 18 }}>
          <Campo label="Qual aparelho você tem? (opcional)">
            <input value={descricao} onChange={(e) => onDescricaoChange(e.target.value)}
              placeholder="Ex.: Split 12.000 BTU marca X, comprado há 2 anos" style={input} />
          </Campo>
          <div style={{ ...avisoBox, background: "var(--cool-wash)", color: "var(--cool-deep)" }}>
            Pela sua descrição do ambiente, a capacidade indicada é <strong>{formatarBtu(btu.btuRecomendado)}</strong>.
            O profissional confirma na visita se o seu aparelho atende.
          </div>
        </div>
      )}
      <Nav onBack={onBack} onNext={onNext} nextLabel="Continuar" disabled={disabled} />
    </>
  );
}
