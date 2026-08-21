import type { calcularBtu } from "@/lib/btu";
import { formatarBtu } from "@/lib/btu";
import { formatarBRL } from "@/lib/pricing";
import { Search } from "@/components/icons";
import { Aviso, H, Nav } from "../shared-components";
import { abaAmbiente, abaAmbienteOn, badgeRec, input, prodCard, prodCardSel } from "../styles";
import { mono } from "../constants";
import type { AmbienteForm } from "../types";
import type { ProdutoDTO } from "../../marketplace-types";

export function StepCatalogo({
  ambientes, ambienteAtivo, focoSeguro, onFocoChange, btus,
  sabeAparelho, qtdRecomendados, btu, produtoBusca, onBuscaChange, buscaErro,
  produtosCarregando, produtosOrdenados, onEscolherProduto, produtosLista, produtosTotal,
  onCarregarMais, disabled, onBack, onNext,
}: {
  ambientes: AmbienteForm[];
  ambienteAtivo: AmbienteForm;
  focoSeguro: number;
  onFocoChange: (i: number) => void;
  btus: ReturnType<typeof calcularBtu>[];
  sabeAparelho: boolean | null;
  qtdRecomendados: number;
  btu: ReturnType<typeof calcularBtu>;
  produtoBusca: string;
  onBuscaChange: (v: string) => void;
  buscaErro: string | null;
  produtosCarregando: boolean;
  produtosOrdenados: (ProdutoDTO & { recomendado: boolean })[];
  onEscolherProduto: (produto: ProdutoDTO) => void;
  produtosLista: ProdutoDTO[];
  produtosTotal: number;
  onCarregarMais: () => void;
  disabled: boolean;
  onBack: () => void;
  onNext: () => void;
}) {
  return (
    <>
      <H titulo={ambientes.length > 1 ? `Aparelho para ${ambienteAtivo.nome || "este ambiente"}` : "Escolha o aparelho"}
        sub={sabeAparelho === false
          ? "Sem preço por aqui: navegue pelos tipos disponíveis. O profissional escolhe o modelo exato e o valor na proposta."
          : qtdRecomendados > 0
          ? `${qtdRecomendados} modelo(s) na capacidade ideal de ${formatarBtu(btu.btuRecomendado)} — aparecem primeiro.`
          : `Nenhum modelo exatamente de ${formatarBtu(btu.btuRecomendado)}. Listamos do mais próximo ao mais distante.`} />

      {/* Uma aba por cômodo: cada ambiente tem sua carga térmica, então cada
          um tem seu catálogo filtrado. O ✓ mostra o que já foi resolvido. */}
      {ambientes.length > 1 && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 18 }}>
          {ambientes.map((a, i) => (
            <button key={a.chave} type="button" onClick={() => onFocoChange(i)}
              aria-pressed={i === focoSeguro}
              style={{ ...abaAmbiente, ...(i === focoSeguro ? abaAmbienteOn : {}) }}>
              {a.produtoId ? "✓ " : ""}{a.nome || `Ambiente ${i + 1}`} · {formatarBtu(btus[i].btuRecomendado)}
            </button>
          ))}
        </div>
      )}

      <div style={{ position: "relative", marginBottom: 18 }}>
        <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--ink-faint)", display: "flex" }}>
          <Search size={17} />
        </span>
        <input
          value={produtoBusca}
          onChange={(e) => onBuscaChange(e.target.value)}
          placeholder="Buscar por marca, modelo ou distribuidora"
          style={{ ...input, paddingLeft: 38 }}
        />
      </div>

      {buscaErro && <Aviso>{buscaErro}</Aviso>}
      {produtosCarregando && produtosOrdenados.length === 0 ? (
        <Aviso>Carregando aparelhos disponíveis…</Aviso>
      ) : produtosOrdenados.length === 0 ? (
        <Aviso>Nenhum aparelho disponível no catálogo com essa busca.</Aviso>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(210px,1fr))", gap: 14 }}>
            {produtosOrdenados.map((p) => {
              const sel = p.id === ambienteAtivo.produtoId;
              return (
                <button key={p.id} onClick={() => onEscolherProduto(p)} style={{ ...prodCard, ...(sel ? prodCardSel : {}) }}>
                  {p.recomendado && <span style={badgeRec}>Ideal para seu ambiente</span>}
                  {p.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.imageUrl} alt={p.modelo} style={{ width: "100%", height: 120, objectFit: "contain", background: "#fff", borderRadius: 8 }} />
                  ) : <div style={{ height: 120 }} />}
                  <span style={{ fontSize: 11, fontFamily: mono, color: "var(--cool)", textTransform: "uppercase" }}>{p.marca}</span>
                  <span style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.3 }}>{p.modelo}</span>
                  <span style={{ fontSize: 12, color: "var(--ink-faint)" }}>{formatarBtu(p.btu)}</span>
                  {p.precoVenda !== null && (
                    <span style={{ fontSize: "1.05rem", fontWeight: 800 }}>{formatarBRL(p.precoVenda)}</span>
                  )}
                  <span style={{ fontSize: 11.5, color: "var(--ink-faint)" }}>
                    {p.distribuidora ? `Distribuidora: ${p.distribuidora}` : "Distribuidora não informada"}
                  </span>
                </button>
              );
            })}
          </div>
          {produtosLista.length < produtosTotal && (
            <button type="button" className="btn" onClick={onCarregarMais} disabled={produtosCarregando}
              style={{ marginTop: 16, width: "100%" }}>
              {produtosCarregando ? "Carregando…" : `Mostrar mais (${produtosLista.length} de ${produtosTotal})`}
            </button>
          )}
        </>
      )}
      <Nav onBack={onBack} onNext={onNext} nextLabel="Ver carrinho" disabled={disabled} />
    </>
  );
}
