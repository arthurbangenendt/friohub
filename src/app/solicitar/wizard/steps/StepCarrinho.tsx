import type { calcularBtu } from "@/lib/btu";
import { formatarBtu } from "@/lib/btu";
import { formatarBRL } from "@/lib/pricing";
import { Aviso, H, LinhaResumo, Nav } from "../shared-components";
import { avisoBox, carrinhoItem, linkBtn, resumo } from "../styles";
import type { AmbienteForm } from "../types";

export function StepCarrinho({
  sabeAparelho, ambientes, btus, onFocoChange, onRemoverAmbiente,
  totalProdutosEscolhidos, disabled, onBack, onNext,
}: {
  sabeAparelho: boolean | null;
  ambientes: AmbienteForm[];
  btus: ReturnType<typeof calcularBtu>[];
  onFocoChange: (i: number) => void;
  onRemoverAmbiente: (i: number) => void;
  totalProdutosEscolhidos: number;
  disabled: boolean;
  onBack: () => void;
  onNext: () => void;
}) {
  return (
    <>
      <H titulo="Confira o que você vai pedir"
        sub={sabeAparelho === false
          ? "Sem preço fechado ainda: o profissional escolhe o modelo exato dessa categoria e propõe o valor junto com o serviço."
          : "Os aparelhos são vendidos pela distribuidora e só são comprados quando você aceitar uma proposta de instalação."} />
      <div style={{ display: "grid", gap: 12 }}>
        {ambientes.map((a, i) => (
          <div key={a.chave} style={carrinhoItem}>
            {a.produto?.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={a.produto.imageUrl} alt={a.produto.modelo} style={{ width: 64, height: 64, objectFit: "contain", background: "#fff", borderRadius: 8, flexShrink: 0 }} />
            ) : <div style={{ width: 64, height: 64, borderRadius: 8, background: "var(--surface-2)", flexShrink: 0 }} />}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 12.5, color: "var(--ink-faint)" }}>{a.nome || `Ambiente ${i + 1}`} · {formatarBtu(btus[i].btuRecomendado)}</div>
              <div style={{ fontWeight: 700, fontSize: 14.5 }}>
                {a.produto ? `${a.produto.marca} ${a.produto.modelo}` : "Nenhum aparelho escolhido"}
                {sabeAparelho === false && a.produto && <span style={{ fontWeight: 500, color: "var(--ink-faint)" }}> (referência)</span>}
              </div>
              {a.produto?.distribuidora && <div style={{ fontSize: 12, color: "var(--ink-faint)" }}>Distribuidora: {a.produto.distribuidora}</div>}
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8 }}>
                <button type="button" onClick={() => onFocoChange(i)} style={linkBtn}>Trocar aparelho</button>
                {ambientes.length > 1 && (
                  <button type="button" onClick={() => onRemoverAmbiente(i)} style={{ ...linkBtn, color: "var(--danger)" }}>Remover ambiente</button>
                )}
              </div>
            </div>
            <div style={{ textAlign: "right", flexShrink: 0 }}>
              <div style={{ fontSize: 13, color: "var(--ink-faint)" }}>{a.quantidade > 1 ? `${a.quantidade}x` : ""}</div>
              <strong style={{ fontSize: 15 }}>
                {sabeAparelho === false ? "A definir" : a.produto?.precoVenda != null ? formatarBRL(a.produto.precoVenda * a.quantidade) : "-"}
              </strong>
            </div>
          </div>
        ))}
      </div>
      {sabeAparelho === false ? (
        <div style={{ ...avisoBox, background: "var(--cool-wash)", color: "var(--cool-deep)" }}>
          O valor do aparelho entra na proposta que o profissional te enviar — compare o pacote completo (aparelho + instalação) antes de aceitar.
        </div>
      ) : (
        <div style={{ ...resumo, marginTop: 16 }}>
          <LinhaResumo k={<strong>Total dos aparelhos</strong>} v={<strong>{formatarBRL(totalProdutosEscolhidos)}</strong>} />
        </div>
      )}
      {disabled && <Aviso erro>Escolha um tipo de aparelho para cada ambiente antes de continuar.</Aviso>}
      <Nav onBack={onBack} onNext={onNext} nextLabel="Escolher profissional" disabled={disabled} />
    </>
  );
}
