import { EscolhaGrande, H, Nav } from "../shared-components";

export function StepAparelhoConhecido({
  sabeAparelho, onEscolher, disabled, onBack, onNext,
}: {
  sabeAparelho: boolean | null;
  onEscolher: (v: boolean) => void;
  disabled: boolean;
  onBack: () => void;
  onNext: () => void;
}) {
  return (
    <>
      <H titulo="Você já sabe qual modelo de aparelho vai comprar?"
        sub="É diferente da pergunta anterior: aqui é sobre saber a marca e o modelo exatos, não sobre já possuir um." />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px,1fr))", gap: 12 }}>
        <EscolhaGrande
          titulo="Sim, já sei o modelo"
          desc=""
          ativo={sabeAparelho === true}
          onClick={() => onEscolher(true)}
        />
        <EscolhaGrande
          titulo="Não, quero comparar antes"
          desc=""
          ativo={sabeAparelho === false}
          onClick={() => onEscolher(false)}
        />
      </div>
      <Nav onBack={onBack} onNext={onNext} nextLabel="Continuar" disabled={disabled} />
    </>
  );
}
