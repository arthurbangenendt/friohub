"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { criarChaveApi, revogarChaveApi } from "./actions";
import { Campo, Alert, EmptyState } from "@/components/ui";

const mono = "var(--font-geist-mono), ui-monospace, monospace";

export type ChaveApiLinha = {
  id: string;
  nome: string;
  key_prefix: string;
  criado_em: string;
  revogado_em: string | null;
  last_used_at: string | null;
};

const dataCurta = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" }) : "Nunca";

/* Gestão de chave de API pra sync de catálogo via ERP.
 *
 * A chave crua só aparece uma vez, na resposta de `criarChaveApi` — depois
 * disso o banco só guarda o hash (20260903110000_distributor_api_keys.sql).
 * Se a distribuidora fechar a página sem copiar, precisa criar outra. */
export function IntegracoesEditor({ chaves }: { chaves: ChaveApiLinha[] }) {
  const router = useRouter();
  const [nome, setNome] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [chaveNova, setChaveNova] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function criar() {
    setErro(null);
    startTransition(async () => {
      const r = await criarChaveApi(nome);
      if (!r.ok) return setErro(r.error);
      setChaveNova(r.chave);
      setNome("");
      router.refresh();
    });
  }

  function revogar(id: string) {
    if (!confirm("Revogar esta chave? O sistema que a usa vai parar de conseguir sincronizar o catálogo.")) return;
    setErro(null);
    startTransition(async () => {
      const r = await revogarChaveApi(id);
      if (!r.ok) setErro(r.error);
      router.refresh();
    });
  }

  const ativas = chaves.filter((c) => !c.revogado_em);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
      {chaveNova && (
        <Alert tipo="aviso" titulo="Copie a chave agora — ela não será exibida de novo">
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 6, flexWrap: "wrap" }}>
            <code style={{
              fontFamily: mono, fontSize: 13, background: "var(--surface)", border: "1px solid var(--line)",
              borderRadius: 8, padding: "8px 10px", userSelect: "all", wordBreak: "break-all",
            }}>
              {chaveNova}
            </code>
            <button type="button" className="btn" onClick={() => navigator.clipboard?.writeText(chaveNova)}
              style={{ height: 34, padding: "0 12px", fontSize: 13, border: "1px solid var(--line)", background: "var(--surface)" }}>
              Copiar
            </button>
            <button type="button" className="btn" onClick={() => setChaveNova(null)}
              style={{ height: 34, padding: "0 12px", fontSize: 13, border: "1px solid var(--line)", background: "var(--surface)" }}>
              Já copiei
            </button>
          </div>
        </Alert>
      )}

      <div className="card" style={{ padding: 22, display: "flex", flexDirection: "column", gap: 14 }}>
        <strong style={{ fontSize: 15.5 }}>Nova chave</strong>
        <div style={{ display: "flex", gap: 12, alignItems: "end", flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 220 }}>
            <Campo rotulo="Nome" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: ERP produção" />
          </div>
          <button className="btn btn-primary" onClick={criar} disabled={pending || nome.trim().length < 2}>
            {pending ? "Criando…" : "Criar chave"}
          </button>
        </div>
        {erro && <Alert tipo="erro">{erro}</Alert>}
      </div>

      <div>
        <strong style={{ fontSize: 15.5, display: "block", marginBottom: 10 }}>
          Chaves ({ativas.length} ativa{ativas.length === 1 ? "" : "s"})
        </strong>
        {chaves.length === 0 ? (
          <EmptyState
            titulo="Nenhuma chave criada ainda"
            descricao="Crie uma chave para conectar o sistema da sua distribuidora e sincronizar o catálogo automaticamente."
          />
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {chaves.map((c) => (
              <div key={c.id} className="card" style={{ padding: 16, display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
                <div style={{ flex: 1, minWidth: 200 }}>
                  <div style={{ fontWeight: 700, fontSize: 14.5 }}>{c.nome}</div>
                  <div style={{ fontSize: 13, color: "var(--ink-soft)", fontFamily: mono }}>{c.key_prefix}…</div>
                  <div style={{ fontSize: 12.5, color: "var(--ink-faint)", marginTop: 3 }}>
                    Criada em {dataCurta(c.criado_em)} · Último uso: {dataCurta(c.last_used_at)}
                    {c.revogado_em && ` · Revogada em ${dataCurta(c.revogado_em)}`}
                  </div>
                </div>
                {!c.revogado_em && (
                  <button className="btn" onClick={() => revogar(c.id)} disabled={pending}
                    style={{ height: 34, padding: "0 12px", fontSize: 13, border: "1px solid var(--line)", background: "var(--surface)", color: "var(--danger)" }}>
                    Revogar
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card" style={{ padding: 22, display: "flex", flexDirection: "column", gap: 10 }}>
        <strong style={{ fontSize: 15.5 }}>Como conectar seu ERP</strong>
        <p style={{ fontSize: 13.5, color: "var(--ink-soft)", margin: 0, lineHeight: 1.6 }}>
          Envie um <code>POST</code> com a chave no cabeçalho <code>Authorization: Bearer &lt;chave&gt;</code> para
          o endpoint de sincronização. Cada envio cria um lote que fica pronto para revisão em{" "}
          <Link href="/painel/distribuidora/importacoes">Importações</Link> antes de qualquer produto entrar no catálogo.
        </p>
        <pre style={{
          background: "var(--surface-2)", padding: 14, borderRadius: 10, fontSize: 12.5, overflow: "auto",
          fontFamily: mono, margin: 0,
        }}>
{`POST /functions/v1/product-import-ingest
Authorization: Bearer fh_live_...
Content-Type: application/json

{
  "idempotency_key": "sync-2026-09-03-0300",
  "itens": [
    {
      "sku_distribuidor": "MID-SPL-9K-INV-01",
      "marca": "Midea",
      "modelo": "Springer Midea Xtreme Save 9000 BTU Inverter",
      "btu": 9000,
      "categoria": "inverter",
      "custo": 1450.00,
      "estoque_quantidade": 12,
      "ativo": true,
      "image_url": "https://seu-erp.com/fotos/produto.jpg"
    }
  ]
}`}
        </pre>
        <p style={{ fontSize: 12.5, color: "var(--ink-faint)", margin: 0 }}>
          Categoria aceita exatamente: split, inverter, multi_split, piso_teto ou janela. Até 2000 itens por
          chamada — catálogos maiores paginam em mais de um envio. O preço final ao cliente continua sendo
          calculado pela FrioHub a partir do custo enviado, como no cadastro manual.
        </p>
      </div>
    </div>
  );
}
