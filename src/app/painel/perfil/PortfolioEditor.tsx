"use client";

import { useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/** Quantos pares antes/depois o profissional pode publicar.
 *  Um número só, num lugar só — ajuste aqui se a regra mudar. */
export const MAX_PARES = 6;
const MAX_MB = 5;

export type FotoItem = {
  id: string;
  url: string;
  grupo_id: string | null;
  momento: string | null;
  caption: string | null;
  position: number;
};

type Par = { grupoId: string; antes: FotoItem | null; depois: FotoItem | null; caption: string };

/* Agrupa as linhas em pares. Fotos sem grupo (avulsas, de antes desta feature)
   entram como par só-com-"depois", para nunca sumirem da tela do profissional
   sem ele saber. */
function montarPares(itens: FotoItem[]): Par[] {
  const mapa = new Map<string, Par>();
  for (const i of [...itens].sort((a, b) => a.position - b.position)) {
    const chave = i.grupo_id ?? `avulsa-${i.id}`;
    const par = mapa.get(chave) ?? { grupoId: chave, antes: null, depois: null, caption: i.caption ?? "" };
    if (i.momento === "antes") par.antes = i;
    else par.depois = i;
    if (i.caption) par.caption = i.caption;
    mapa.set(chave, par);
  }
  return [...mapa.values()];
}

export function PortfolioEditor({ uid, inicial }: { uid: string; inicial: FotoItem[] }) {
  const supabase = createClient();
  const [pares, setPares] = useState<Par[]>(() => montarPares(inicial));
  const [enviando, setEnviando] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const alvo = useRef<{ grupoId: string; momento: "antes" | "depois" } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const cheio = pares.length >= MAX_PARES;

  function novoPar() {
    if (cheio) return;
    setPares((p) => [...p, { grupoId: crypto.randomUUID(), antes: null, depois: null, caption: "" }]);
  }

  function abrirSeletor(grupoId: string, momento: "antes" | "depois") {
    alvo.current = { grupoId, momento };
    inputRef.current?.click();
  }

  async function aoEscolher(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    const destino = alvo.current;
    if (!file || !destino) return;
    setErro(null);

    if (!file.type.startsWith("image/")) { setErro("Envie apenas imagens."); return; }
    if (file.size > MAX_MB * 1024 * 1024) { setErro(`Cada imagem deve ter até ${MAX_MB} MB.`); return; }

    const chave = `${destino.grupoId}-${destino.momento}`;
    setEnviando(chave);
    try {
      const ext = file.name.split(".").pop() || "jpg";
      const path = `${uid}/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage.from("portfolio").upload(path, file);
      if (upErr) { setErro(upErr.message); return; }

      const { data: pub } = supabase.storage.from("portfolio").getPublicUrl(path);
      const par = pares.find((p) => p.grupoId === destino.grupoId);
      const antigo = destino.momento === "antes" ? par?.antes : par?.depois;

      const { data: row, error: insErr } = await supabase
        .from("portfolio_items")
        .insert({
          professional_id: uid,
          media_type: "foto",
          url: pub.publicUrl,
          grupo_id: destino.grupoId,
          momento: destino.momento,
          caption: par?.caption || null,
          position: pares.findIndex((p) => p.grupoId === destino.grupoId),
        })
        .select("id, url, grupo_id, momento, caption, position")
        .single();

      if (insErr || !row) {
        // Não deixa arquivo órfão no bucket quando a linha não entra.
        await supabase.storage.from("portfolio").remove([path]);
        setErro(insErr?.message ?? "Erro ao salvar.");
        return;
      }

      // Substituir uma foto do par remove a anterior, para o bucket não crescer.
      if (antigo) await apagarLinhaEArquivo(antigo);

      setPares((cur) => cur.map((p) => p.grupoId === destino.grupoId
        ? { ...p, [destino.momento]: row as FotoItem }
        : p));
    } finally {
      setEnviando(null);
      alvo.current = null;
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function apagarLinhaEArquivo(item: FotoItem) {
    await supabase.from("portfolio_items").delete().eq("id", item.id);
    const marcador = "/portfolio/";
    const idx = item.url.indexOf(marcador);
    if (idx >= 0) await supabase.storage.from("portfolio").remove([item.url.slice(idx + marcador.length)]);
  }

  async function removerPar(par: Par) {
    setErro(null);
    if (par.antes) await apagarLinhaEArquivo(par.antes);
    if (par.depois) await apagarLinhaEArquivo(par.depois);
    setPares((cur) => cur.filter((p) => p.grupoId !== par.grupoId));
  }

  async function salvarLegenda(par: Par, texto: string) {
    setPares((cur) => cur.map((p) => p.grupoId === par.grupoId ? { ...p, caption: texto } : p));
    const ids = [par.antes?.id, par.depois?.id].filter(Boolean) as string[];
    if (ids.length) await supabase.from("portfolio_items").update({ caption: texto || null }).in("id", ids);
  }

  return (
    <div>
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {pares.map((par, i) => (
          <div key={par.grupoId} style={{ border: "1px solid var(--line)", borderRadius: 14, padding: 14, background: "var(--bg)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <span style={{ fontSize: 12.5, fontWeight: 650, color: "var(--ink-faint)" }}>Serviço {i + 1}</span>
              <button type="button" onClick={() => removerPar(par)}
                style={{ border: "none", background: "none", color: "var(--ink-faint)", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>
                Remover
              </button>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <Slot rotulo="Antes" item={par.antes} enviando={enviando === `${par.grupoId}-antes`}
                onClick={() => abrirSeletor(par.grupoId, "antes")} />
              <Slot rotulo="Depois" item={par.depois} enviando={enviando === `${par.grupoId}-depois`}
                onClick={() => abrirSeletor(par.grupoId, "depois")} />
            </div>

            <input
              defaultValue={par.caption}
              onBlur={(e) => salvarLegenda(par, e.target.value.trim())}
              placeholder="Ex.: Higienização de split 12.000 em apartamento"
              style={{ marginTop: 10, height: 38, padding: "0 12px", borderRadius: 9, border: "1px solid var(--line)", background: "var(--surface)", color: "var(--ink)", fontSize: 13.5, width: "100%" }}
            />
          </div>
        ))}
      </div>

      <button type="button" onClick={novoPar} disabled={cheio}
        style={{
          marginTop: pares.length ? 14 : 0, width: "100%", padding: "14px", borderRadius: 12,
          border: "1.5px dashed var(--line)", background: "var(--bg)",
          color: cheio ? "var(--ink-faint)" : "var(--cool-deep)",
          fontSize: 13.5, fontWeight: 650, cursor: cheio ? "not-allowed" : "pointer",
        }}>
        {cheio ? `Limite de ${MAX_PARES} serviços atingido` : "+ Adicionar antes e depois"}
      </button>

      <input ref={inputRef} type="file" accept="image/*" onChange={aoEscolher} style={{ display: "none" }} />
      {erro && <p style={{ color: "#b3261e", fontSize: 13.5, marginTop: 10 }}>{erro}</p>}
      <p style={{ color: "var(--ink-faint)", fontSize: 12.5, marginTop: 12 }}>
        Até {MAX_PARES} serviços, cada um com foto antes e depois. É o que mais pesa
        na hora do cliente escolher. Até {MAX_MB} MB por imagem.
      </p>
    </div>
  );
}

function Slot({ rotulo, item, enviando, onClick }: { rotulo: string; item: FotoItem | null; enviando: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} disabled={enviando}
      style={{
        position: "relative", aspectRatio: "4/3", borderRadius: 11, overflow: "hidden",
        border: item ? "1px solid var(--line)" : "1.5px dashed var(--line)",
        background: item ? "var(--surface-2)" : "var(--surface)",
        cursor: "pointer", padding: 0, display: "grid", placeItems: "center",
      }}>
      {item ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={item.url} alt={rotulo} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      ) : (
        <span style={{ color: "var(--ink-faint)", fontSize: 13, fontWeight: 600 }}>
          {enviando ? "Enviando..." : `+ ${rotulo}`}
        </span>
      )}
      <span style={{
        position: "absolute", top: 7, left: 7, fontSize: 10.5, fontWeight: 700,
        textTransform: "uppercase", letterSpacing: ".06em", padding: "3px 8px", borderRadius: 100,
        background: "rgba(12,30,42,.72)", color: "#fff",
      }}>{rotulo}</span>
    </button>
  );
}
