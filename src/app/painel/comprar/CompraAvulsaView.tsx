"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatarBRL } from "@/lib/pricing";
import { formatarBtu } from "@/lib/btu";
import { Search } from "@/components/icons";
import { Campo } from "@/components/ui";
import { carregarPagina } from "@/app/solicitar/wizard/api";
import { input as inputEstilo, prodCard } from "@/app/solicitar/wizard/styles";
import type { ProdutoDTO } from "@/app/solicitar/marketplace-types";
import { SeloDistribuidora } from "@/app/solicitar/wizard/steps/SeloDistribuidora";
import { criarCompraAvulsa } from "./actions";

type EnderecoPadrao = { cep: string; cidade: string; endereco: string };

export function CompraAvulsaView({ enderecoPadrao }: { enderecoPadrao: EnderecoPadrao }) {
  const router = useRouter();

  const [busca, setBusca] = useState("");
  const [produtos, setProdutos] = useState<ProdutoDTO[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [erroBusca, setErroBusca] = useState<string | null>(null);

  // Cache separado da lista filtrada: um item no carrinho não pode "sumir" do
  // resumo só porque uma busca nova não trouxe ele de volta.
  const [catalogo, setCatalogo] = useState<Record<string, ProdutoDTO>>({});
  const [carrinho, setCarrinho] = useState<Record<string, number>>({});

  const [cep, setCep] = useState(enderecoPadrao.cep);
  const [cidade, setCidade] = useState(enderecoPadrao.cidade);
  const [endereco, setEndereco] = useState(enderecoPadrao.endereco);

  const [enviando, startEnvio] = useTransition();
  const [erroEnvio, setErroEnvio] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setCarregando(true);
      setErroBusca(null);
      const params = new URLSearchParams({ kind: "produtos", page: "1" });
      if (busca.trim()) params.set("q", busca.trim());
      carregarPagina<ProdutoDTO>(params, controller.signal)
        .then((r) => {
          setCatalogo((prev) => ({ ...prev, ...Object.fromEntries(r.items.map((p) => [p.id, p])) }));
          setProdutos(r.items);
          setTotal(r.total);
          setPage(1);
          setHasMore(r.hasMore);
        })
        .catch((e: Error) => {
          if (e.name !== "AbortError") setErroBusca(e.message);
        })
        .finally(() => setCarregando(false));
    }, 300);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [busca]);

  function carregarMais() {
    setCarregando(true);
    const params = new URLSearchParams({ kind: "produtos", page: String(page + 1) });
    if (busca.trim()) params.set("q", busca.trim());
    carregarPagina<ProdutoDTO>(params)
      .then((r) => {
        setCatalogo((prev) => ({ ...prev, ...Object.fromEntries(r.items.map((p) => [p.id, p])) }));
        setProdutos((prev) => [...prev, ...r.items]);
        setPage((p) => p + 1);
        setHasMore(r.hasMore);
      })
      .catch((e: Error) => setErroBusca(e.message))
      .finally(() => setCarregando(false));
  }

  function alterarQtd(produtoId: string, delta: number) {
    setCarrinho((prev) => {
      const atual = prev[produtoId] ?? 0;
      const nova = Math.max(0, Math.min(20, atual + delta));
      const proximo = { ...prev };
      if (nova === 0) delete proximo[produtoId];
      else proximo[produtoId] = nova;
      return proximo;
    });
  }

  const itensCarrinho = Object.entries(carrinho)
    .map(([produtoId, quantidade]) => ({ produto: catalogo[produtoId], quantidade }))
    .filter((i): i is { produto: ProdutoDTO; quantidade: number } => Boolean(i.produto));
  const totalCarrinho = itensCarrinho.reduce((s, i) => s + (i.produto.precoVenda ?? 0) * i.quantidade, 0);

  function finalizar() {
    setErroEnvio(null);
    if (itensCarrinho.length === 0) return setErroEnvio("Adicione ao menos um item ao carrinho.");
    if (!cep.trim() || !cidade.trim() || !endereco.trim()) {
      return setErroEnvio("Preencha CEP, cidade e endereço completo de entrega.");
    }
    startEnvio(async () => {
      const r = await criarCompraAvulsa({
        itens: itensCarrinho.map((i) => ({ produtoId: i.produto.id, quantidade: i.quantidade })),
        cep: cep.trim(),
        cidade: cidade.trim(),
        endereco: endereco.trim(),
      });
      if (!r.ok) return setErroEnvio(r.error);
      router.push(`/servico/${r.jobId}`);
    });
  }

  return (
    <div style={{ display: "grid", gap: 24 }}>
      <div style={{ position: "relative" }}>
        <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--ink-faint)", display: "flex" }}>
          <Search size={17} />
        </span>
        <input
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar por marca, modelo ou distribuidora"
          style={{ ...inputEstilo, paddingLeft: 38 }}
        />
      </div>

      {erroBusca && <p style={{ color: "var(--danger)", fontSize: 13.5, margin: 0 }}>{erroBusca}</p>}
      {carregando && produtos.length === 0 ? (
        <p style={{ color: "var(--ink-faint)", fontSize: 14 }}>Carregando catálogo…</p>
      ) : produtos.length === 0 ? (
        <p style={{ color: "var(--ink-faint)", fontSize: 14 }}>Nenhum produto encontrado.</p>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(210px,1fr))", gap: 14 }}>
            {produtos.map((p) => {
              const qtd = carrinho[p.id] ?? 0;
              return (
                <div key={p.id} style={prodCard}>
                  {p.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={p.imageUrl} alt={p.modelo} style={{ width: "100%", height: 120, objectFit: "contain", background: "#fff", borderRadius: 8 }} />
                  ) : <div style={{ height: 120 }} />}
                  <span style={{ fontSize: 11, fontFamily: "var(--font-geist-mono), ui-monospace, monospace", color: "var(--cool)", textTransform: "uppercase" }}>{p.marca}</span>
                  <span style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.3 }}>{p.modelo}</span>
                  <span style={{ fontSize: 12, color: "var(--ink-faint)" }}>{formatarBtu(p.btu)}</span>
                  {p.precoVenda !== null && <span style={{ fontSize: "1.05rem", fontWeight: 800 }}>{formatarBRL(p.precoVenda)}</span>}
                  <span style={{ fontSize: 11.5, color: "var(--ink-faint)" }}>
                    {p.distribuidora ? `Distribuidora: ${p.distribuidora}` : "Distribuidora não informada"}
                  </span>
                  {p.distributorId && <SeloDistribuidora distributorId={p.distributorId} />}

                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 8 }}>
                    {qtd === 0 ? (
                      <button type="button" className="btn btn-primary" style={{ width: "100%", height: 36 }} onClick={() => alterarQtd(p.id, 1)}>
                        Adicionar
                      </button>
                    ) : (
                      <div style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", justifyContent: "space-between" }}>
                        <button type="button" onClick={() => alterarQtd(p.id, -1)} aria-label="Diminuir quantidade"
                          style={{ width: 32, height: 32, borderRadius: 8, border: "1px solid var(--line)", background: "var(--surface)", cursor: "pointer" }}>−</button>
                        <strong style={{ fontSize: 14 }}>{qtd}</strong>
                        <button type="button" onClick={() => alterarQtd(p.id, 1)} aria-label="Aumentar quantidade"
                          style={{ width: 32, height: 32, borderRadius: 8, border: "1px solid var(--line)", background: "var(--surface)", cursor: "pointer" }}>+</button>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          {hasMore && (
            <button type="button" className="btn" onClick={carregarMais} disabled={carregando} style={{ width: "100%" }}>
              {carregando ? "Carregando…" : `Mostrar mais (${produtos.length} de ${total})`}
            </button>
          )}
        </>
      )}

      {itensCarrinho.length > 0 && (
        <div className="card" style={{ padding: 22, display: "grid", gap: 16 }}>
          <strong style={{ fontSize: 15.5 }}>Carrinho e entrega</strong>

          <div style={{ display: "grid", gap: 8 }}>
            {itensCarrinho.map(({ produto, quantidade }) => (
              <div key={produto.id} style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 14 }}>
                <span>{quantidade}× {produto.marca} {produto.modelo}</span>
                <strong>{formatarBRL((produto.precoVenda ?? 0) * quantidade)}</strong>
              </div>
            ))}
            <div style={{ display: "flex", justifyContent: "space-between", paddingTop: 10, borderTop: "1px solid var(--line-soft)", fontSize: 15 }}>
              <strong>Total</strong>
              <strong>{formatarBRL(totalCarrinho)}</strong>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px,1fr))", gap: 12 }}>
            <Campo rotulo="CEP" value={cep} onChange={(e) => setCep(e.target.value)} inputMode="numeric" placeholder="00000-000" />
            <Campo rotulo="Cidade" value={cidade} onChange={(e) => setCidade(e.target.value)} placeholder="Ex.: São Paulo" />
          </div>
          <Campo rotulo="Endereço completo" value={endereco} onChange={(e) => setEndereco(e.target.value)}
            placeholder="Rua, número, complemento, bairro" />

          {erroEnvio && <p style={{ color: "var(--danger)", fontSize: 13.5, margin: 0 }}>{erroEnvio}</p>}

          <button type="button" className="btn btn-primary" onClick={finalizar} disabled={enviando} style={{ justifySelf: "start" }}>
            {enviando ? "Finalizando…" : `Finalizar compra — ${formatarBRL(totalCarrinho)}`}
          </button>
        </div>
      )}
    </div>
  );
}
