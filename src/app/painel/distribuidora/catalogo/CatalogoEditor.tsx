"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatarBRL } from "@/lib/pricing";
import { formatarBtu } from "@/lib/btu";
import { alternarEstoque, salvarProduto } from "../actions";

export type ProdutoLinha = {
  id: string;
  marca: string;
  modelo: string;
  btu: number;
  categoria: string;
  custo: number;
  preco_venda: number;
  preco_manual: boolean;
  image_url: string | null;
  ativo: boolean;
  estoque_disponivel: boolean;
};

const CATEGORIAS = ["split", "inverter", "multi_split", "piso_teto", "janela"];
const CAT_LABEL: Record<string, string> = {
  split: "Split", inverter: "Inverter", multi_split: "Multi-split", piso_teto: "Piso-teto", janela: "Janela",
};

const campo: React.CSSProperties = {
  width: "100%", padding: "11px 14px", borderRadius: 11, border: "1px solid var(--line)",
  background: "var(--surface)", fontSize: 14.5, fontFamily: "inherit", color: "var(--ink)",
};
const rotulo: React.CSSProperties = { fontSize: 13, fontWeight: 650, color: "var(--ink-soft)", display: "block", marginBottom: 6 };

/* Catálogo da distribuidora.
 *
 * A distribuidora informa o CUSTO; o preço ao cliente é derivado pelo markup da
 * plataforma, num trigger no banco. Mostramos o preço resultante aqui para ela
 * enxergar como o produto aparece na vitrine — mas o campo não é editável, e o
 * banco recusaria a escrita de qualquer forma (`protege_produto`).
 */
export function CatalogoEditor({ produtos, markup }: { produtos: ProdutoLinha[]; markup: number }) {
  const router = useRouter();
  const [editando, setEditando] = useState<ProdutoLinha | "novo" | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function alternar(p: ProdutoLinha) {
    startTransition(async () => {
      const r = await alternarEstoque(p.id, !p.estoque_disponivel);
      if (!r.ok) setErro(r.error);
      router.refresh();
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <button className="btn btn-primary" onClick={() => { setEditando("novo"); setErro(null); }}>
          Adicionar produto
        </button>
      </div>

      {erro && <p style={{ color: "#b3261e", fontSize: 13.5, margin: 0 }}>{erro}</p>}

      {editando && (
        <Formulario
          inicial={editando === "novo" ? null : editando}
          markup={markup}
          onCancelar={() => setEditando(null)}
          onSalvo={() => { setEditando(null); router.refresh(); }}
        />
      )}

      {produtos.length === 0 && !editando && (
        <div style={{ padding: 28, borderRadius: 14, border: "1px dashed var(--line)", color: "var(--ink-faint)", fontSize: 14.5, textAlign: "center" }}>
          Nenhum produto ainda. Adicione o primeiro para aparecer na busca dos clientes.
        </div>
      )}

      {produtos.map((p) => (
        <div key={p.id} className="card" style={{ padding: 16, display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
          {p.image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={p.image_url} alt={p.modelo}
              style={{ width: 64, height: 64, objectFit: "contain", background: "#fff", borderRadius: 8, flexShrink: 0 }} />
          ) : (
            <div style={{ width: 64, height: 64, borderRadius: 8, background: "var(--surface-2)", flexShrink: 0 }} />
          )}

          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ fontWeight: 700, fontSize: 14.5 }}>{p.marca}</div>
            <div style={{ fontSize: 13, color: "var(--ink-soft)" }}>{p.modelo}</div>
            <div style={{ fontSize: 12.5, color: "var(--ink-faint)", marginTop: 3 }}>
              {formatarBtu(p.btu)} · {CAT_LABEL[p.categoria] ?? p.categoria}
              {!p.ativo && " · inativo"}
            </div>
          </div>

          <div style={{ textAlign: "right", minWidth: 140 }}>
            <div style={{ fontSize: 12.5, color: "var(--ink-faint)" }}>Seu custo</div>
            <div style={{ fontWeight: 700 }}>{formatarBRL(Number(p.custo))}</div>
            <div style={{ fontSize: 12, color: "var(--ink-faint)", marginTop: 3 }}>
              vitrine {formatarBRL(Number(p.preco_venda))}
              {p.preco_manual && " (fixo)"}
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <button className="btn" onClick={() => { setEditando(p); setErro(null); }} disabled={pending}
              style={{ height: 34, padding: "0 12px", fontSize: 13, border: "1px solid var(--line)", background: "var(--surface)" }}>
              Editar
            </button>
            <button className="btn" onClick={() => alternar(p)} disabled={pending}
              style={{
                height: 34, padding: "0 12px", fontSize: 13, border: "1px solid var(--line)",
                background: p.estoque_disponivel ? "var(--surface)" : "var(--warm-wash)",
                color: p.estoque_disponivel ? "var(--ink)" : "var(--warm)",
              }}>
              {p.estoque_disponivel ? "Em estoque" : "Sem estoque"}
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function Formulario({
  inicial, markup, onCancelar, onSalvo,
}: {
  inicial: ProdutoLinha | null;
  markup: number;
  onCancelar: () => void;
  onSalvo: () => void;
}) {
  const [marca, setMarca] = useState(inicial?.marca ?? "");
  const [modelo, setModelo] = useState(inicial?.modelo ?? "");
  const [btu, setBtu] = useState(String(inicial?.btu ?? 9000));
  const [categoria, setCategoria] = useState(inicial?.categoria ?? "inverter");
  const [custo, setCusto] = useState(inicial ? String(inicial.custo) : "");
  const [imageUrl, setImageUrl] = useState(inicial?.image_url ?? "");
  const [ativo, setAtivo] = useState(inicial?.ativo ?? true);
  const [estoque, setEstoque] = useState(inicial?.estoque_disponivel ?? true);
  const [erro, setErro] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const custoNum = Number(custo.replace(/\./g, "").replace(",", ".")) || 0;
  // Prévia do que o cliente verá. Produto com preço fixado pelo admin não muda.
  const vitrine = inicial?.preco_manual ? Number(inicial.preco_venda) : custoNum * (1 + markup);

  function salvar() {
    setErro(null);
    startTransition(async () => {
      const r = await salvarProduto({
        id: inicial?.id,
        marca, modelo,
        btu: Number(btu) || 0,
        categoria,
        custo: custoNum,
        imageUrl,
        ativo,
        estoqueDisponivel: estoque,
      });
      if (!r.ok) return setErro(r.error);
      onSalvo();
    });
  }

  return (
    <div className="card" style={{ padding: 22, display: "flex", flexDirection: "column", gap: 14 }}>
      <strong style={{ fontSize: 15.5 }}>{inicial ? "Editar produto" : "Novo produto"}</strong>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px,1fr))", gap: 12 }}>
        <label><span style={rotulo}>Marca</span>
          <input value={marca} onChange={(e) => setMarca(e.target.value)} style={campo} placeholder="Ex.: Midea" /></label>
        <label><span style={rotulo}>Capacidade (BTU)</span>
          <input value={btu} onChange={(e) => setBtu(e.target.value)} inputMode="numeric" style={campo} /></label>
        <label><span style={rotulo}>Categoria</span>
          <select value={categoria} onChange={(e) => setCategoria(e.target.value)} style={campo}>
            {CATEGORIAS.map((c) => <option key={c} value={c}>{CAT_LABEL[c]}</option>)}
          </select></label>
      </div>

      <label><span style={rotulo}>Modelo</span>
        <input value={modelo} onChange={(e) => setModelo(e.target.value)} style={campo}
          placeholder="Descrição completa como aparece na nota" /></label>

      <label><span style={rotulo}>URL da imagem</span>
        <input value={imageUrl} onChange={(e) => setImageUrl(e.target.value)} style={campo} placeholder="https://…" /></label>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px,1fr))", gap: 12, alignItems: "end" }}>
        <label><span style={rotulo}>Seu custo (R$)</span>
          <input value={custo} onChange={(e) => setCusto(e.target.value)} inputMode="decimal" style={campo} placeholder="0,00" /></label>
        <div style={{ padding: "11px 14px", borderRadius: 11, background: "var(--surface-2)" }}>
          <div style={{ fontSize: 12.5, color: "var(--ink-faint)" }}>Preço na vitrine</div>
          <div style={{ fontWeight: 700 }}>{formatarBRL(vitrine)}</div>
        </div>
      </div>
      <p style={{ fontSize: 12.5, color: "var(--ink-faint)", margin: 0 }}>
        O preço ao cliente é definido pela FrioHub a partir do seu custo. Você recebe o valor do custo.
      </p>

      <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14 }}>
          <input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} /> Produto ativo
        </label>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14 }}>
          <input type="checkbox" checked={estoque} onChange={(e) => setEstoque(e.target.checked)} /> Em estoque
        </label>
      </div>

      {erro && <p style={{ color: "#b3261e", fontSize: 13.5, margin: 0 }}>{erro}</p>}

      <div style={{ display: "flex", gap: 10 }}>
        <button className="btn btn-primary" onClick={salvar} disabled={pending}>
          {pending ? "Salvando…" : "Salvar"}
        </button>
        <button className="btn" onClick={onCancelar} disabled={pending}
          style={{ border: "1px solid var(--line)", background: "var(--surface)" }}>
          Cancelar
        </button>
      </div>
    </div>
  );
}
