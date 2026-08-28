"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { formatarBRL } from "@/lib/pricing";
import { formatarBtu } from "@/lib/btu";
import { alternarEstoque, salvarProduto } from "../actions";
import { Campo, CampoSelecao } from "@/components/ui";

const MAX_MB_IMAGEM = 8;
const FORMATOS_IMAGEM: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

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
  /* null = modo booleano legado (o botão "Em estoque"/"Sem estoque" manda).
     Número = quantidade controlada: cada venda dá baixa automática aqui. */
  estoque_quantidade: number | null;
};

const CATEGORIAS = ["split", "inverter", "multi_split", "piso_teto", "janela"];
const CAT_LABEL: Record<string, string> = {
  split: "Split", inverter: "Inverter", multi_split: "Multi-split", piso_teto: "Piso-teto", janela: "Janela",
};

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

      {erro && <p style={{ color: "var(--danger)", fontSize: 13.5, margin: 0 }}>{erro}</p>}

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

          <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
            <button className="btn" onClick={() => { setEditando(p); setErro(null); }} disabled={pending}
              style={{ height: 34, padding: "0 12px", fontSize: 13, border: "1px solid var(--line)", background: "var(--surface)" }}>
              Editar
            </button>
            {p.estoque_quantidade !== null ? (
              <span style={{
                height: 34, padding: "0 12px", fontSize: 13, borderRadius: 8, display: "flex", alignItems: "center",
                background: p.estoque_quantidade > 0 ? "var(--surface-2)" : "var(--warm-wash)",
                color: p.estoque_quantidade > 0 ? "var(--ink)" : "var(--warm)",
              }}>
                {p.estoque_quantidade} {p.estoque_quantidade === 1 ? "unidade" : "unidades"}
              </span>
            ) : (
              <button className="btn" onClick={() => alternar(p)} disabled={pending}
                style={{
                  height: 34, padding: "0 12px", fontSize: 13, border: "1px solid var(--line)",
                  background: p.estoque_disponivel ? "var(--surface)" : "var(--warm-wash)",
                  color: p.estoque_disponivel ? "var(--ink)" : "var(--warm)",
                }}>
                {p.estoque_disponivel ? "Em estoque" : "Sem estoque"}
              </button>
            )}
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
  const [estoqueQuantidade, setEstoqueQuantidade] = useState(
    inicial?.estoque_quantidade != null ? String(inicial.estoque_quantidade) : ""
  );
  const [erro, setErro] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const supabase = useMemo(() => createClient(), []);
  const [enviandoImagem, setEnviandoImagem] = useState(false);
  const [erroImagem, setErroImagem] = useState<string | null>(null);
  const [remocoesPendentes, setRemocoesPendentes] = useState<string[]>([]);
  const inputImagemRef = useRef<HTMLInputElement>(null);

  /* Só rastreamos pra apagar depois arquivos que estão no NOSSO bucket —
     produto antigo pode ter uma URL colada manualmente (ou de seed), que a
     gente não tem permissão nem motivo de apagar. */
  function pathNoBucket(url: string): string | null {
    const marcador = "/produtos/";
    const idx = url.indexOf(marcador);
    return idx >= 0 ? url.slice(idx + marcador.length) : null;
  }

  function trocarImagem(novaUrl: string) {
    const antigo = imageUrl ? pathNoBucket(imageUrl) : null;
    if (antigo) setRemocoesPendentes((cur) => [...cur, antigo]);
    setImageUrl(novaUrl);
  }

  async function enviarImagem(file: File) {
    setErroImagem(null);
    const ext = FORMATOS_IMAGEM[file.type];
    if (!ext) { setErroImagem("Use uma imagem JPG, PNG ou WebP."); return; }
    if (file.size > MAX_MB_IMAGEM * 1024 * 1024) { setErroImagem(`A imagem deve ter até ${MAX_MB_IMAGEM} MB.`); return; }

    setEnviandoImagem(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setErroImagem("Sessão expirada — recarregue a página."); return; }

      const path = `${user.id}/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage.from("produtos").upload(path, file, {
        cacheControl: "31536000",
        contentType: file.type,
      });
      if (upErr) { setErroImagem(upErr.message); return; }

      const { data: pub } = supabase.storage.from("produtos").getPublicUrl(path);
      trocarImagem(pub.publicUrl);
    } finally {
      setEnviandoImagem(false);
      if (inputImagemRef.current) inputImagemRef.current.value = "";
    }
  }

  const custoNum = Number(custo.replace(/\./g, "").replace(",", ".")) || 0;
  // Prévia do que o cliente verá. Produto com preço fixado pelo admin não muda.
  const vitrine = inicial?.preco_manual ? Number(inicial.preco_venda) : custoNum * (1 + markup);
  const quantidadePreenchida = estoqueQuantidade.trim() !== "";

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
        estoqueQuantidade: quantidadePreenchida ? Math.max(0, Math.round(Number(estoqueQuantidade)) || 0) : null,
      });
      if (!r.ok) return setErro(r.error);
      // Só apaga as fotos substituídas do bucket depois que o produto salvou —
      // se a distribuidora cancelasse antes, a foto ao vivo não pode sumir.
      if (remocoesPendentes.length) await supabase.storage.from("produtos").remove(remocoesPendentes);
      onSalvo();
    });
  }

  return (
    <div className="card" style={{ padding: 22, display: "flex", flexDirection: "column", gap: 14 }}>
      <strong style={{ fontSize: 15.5 }}>{inicial ? "Editar produto" : "Novo produto"}</strong>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px,1fr))", gap: 12 }}>
        <Campo rotulo="Marca" value={marca} onChange={(e) => setMarca(e.target.value)} placeholder="Ex.: Midea" />
        <Campo rotulo="Capacidade (BTU)" value={btu} onChange={(e) => setBtu(e.target.value)} inputMode="numeric" />
        <CampoSelecao rotulo="Categoria" value={categoria} onChange={(e) => setCategoria(e.target.value)}>
          {CATEGORIAS.map((c) => <option key={c} value={c}>{CAT_LABEL[c]}</option>)}
        </CampoSelecao>
      </div>

      <Campo rotulo="Modelo" value={modelo} onChange={(e) => setModelo(e.target.value)}
        placeholder="Descrição completa como aparece na nota" />

      <div>
        <span style={{ fontSize: 13.5, fontWeight: 650, color: "var(--ink-soft)" }}>Foto do produto</span>
        <div style={{ display: "flex", alignItems: "center", gap: 14, marginTop: 8 }}>
          <div style={{
            width: 72, height: 72, borderRadius: 10, overflow: "hidden", flexShrink: 0,
            background: imageUrl ? "#fff" : "var(--surface-2)", border: "1px solid var(--line)",
            display: "grid", placeItems: "center",
          }}>
            {imageUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={imageUrl} alt="Prévia do produto" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
            )}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" onClick={() => inputImagemRef.current?.click()} disabled={enviandoImagem}
              className="btn" style={{ height: 36, padding: "0 14px", fontSize: 13, border: "1px solid var(--line)", background: "var(--surface)" }}>
              {enviandoImagem ? "Enviando…" : imageUrl ? "Trocar foto" : "Enviar foto"}
            </button>
            {imageUrl && (
              <button type="button" onClick={() => trocarImagem("")} disabled={enviandoImagem}
                className="btn" style={{ height: 36, padding: "0 14px", fontSize: 13, border: "1px solid var(--line)", background: "var(--surface)" }}>
                Remover
              </button>
            )}
          </div>
        </div>
        <input ref={inputImagemRef} type="file" accept="image/jpeg,image/png,image/webp" style={{ display: "none" }}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) enviarImagem(f); }} />
        {erroImagem && <p style={{ color: "var(--danger)", fontSize: 12.5, margin: "6px 0 0" }}>{erroImagem}</p>}
        <p style={{ fontSize: 12.5, color: "var(--ink-faint)", margin: "8px 0 0" }}>
          Aparece na compra do técnico e na triagem do cliente. JPG, PNG ou WebP, até {MAX_MB_IMAGEM} MB.
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px,1fr))", gap: 12, alignItems: "end" }}>
        <Campo rotulo="Seu custo (R$)" value={custo} onChange={(e) => setCusto(e.target.value)} inputMode="decimal" placeholder="0,00" />
        <div style={{ padding: "11px 14px", borderRadius: 11, background: "var(--surface-2)" }}>
          <div style={{ fontSize: 12.5, color: "var(--ink-faint)" }}>Preço na vitrine</div>
          <div style={{ fontWeight: 700 }}>{formatarBRL(vitrine)}</div>
        </div>
      </div>
      <p style={{ fontSize: 12.5, color: "var(--ink-faint)", margin: 0 }}>
        O preço ao cliente é definido pela FrioHub a partir do seu custo. Você recebe o valor do custo.
      </p>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px,1fr))", gap: 12, alignItems: "end" }}>
        <Campo
          rotulo="Quantidade em estoque (opcional)"
          value={estoqueQuantidade}
          onChange={(e) => setEstoqueQuantidade(e.target.value.replace(/[^0-9]/g, ""))}
          inputMode="numeric"
          placeholder="Deixe em branco pra controlar manualmente"
        />
        {!quantidadePreenchida && (
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, height: 42 }}>
            <input type="checkbox" checked={estoque} onChange={(e) => setEstoque(e.target.checked)} /> Em estoque
          </label>
        )}
      </div>
      <p style={{ fontSize: 12.5, color: "var(--ink-faint)", margin: 0 }}>
        {quantidadePreenchida
          ? "Cada venda dá baixa automática nessa quantidade. Some antes de salvar se você reabastecer."
          : "Sem quantidade informada, o controle é manual pelo botão \"Em estoque\"/\"Sem estoque\" na lista."}
      </p>

      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14 }}>
        <input type="checkbox" checked={ativo} onChange={(e) => setAtivo(e.target.checked)} /> Produto ativo
      </label>

      {erro && <p style={{ color: "var(--danger)", fontSize: 13.5, margin: 0 }}>{erro}</p>}

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
