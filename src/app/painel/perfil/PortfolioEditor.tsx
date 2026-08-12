"use client";

import { useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Foto = { id: string; url: string };

export function PortfolioEditor({ uid, inicial }: { uid: string; inicial: Foto[] }) {
  const supabase = createClient();
  const [fotos, setFotos] = useState<Foto[]>(inicial);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function aoEscolher(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    setErro(null);
    setEnviando(true);
    try {
      for (const file of files) {
        if (!file.type.startsWith("image/")) { setErro("Envie apenas imagens."); continue; }
        if (file.size > 5 * 1024 * 1024) { setErro("Cada imagem deve ter até 5 MB."); continue; }

        const ext = file.name.split(".").pop() || "jpg";
        const path = `${uid}/${crypto.randomUUID()}.${ext}`;
        const { error: upErr } = await supabase.storage.from("portfolio").upload(path, file, { upsert: false });
        if (upErr) { setErro(upErr.message); continue; }

        const { data: pub } = supabase.storage.from("portfolio").getPublicUrl(path);
        const { data: row, error: insErr } = await supabase
          .from("portfolio_items")
          .insert({ professional_id: uid, media_type: "foto", url: pub.publicUrl, position: fotos.length })
          .select("id, url")
          .single();
        if (insErr || !row) { setErro(insErr?.message ?? "Erro ao salvar."); continue; }
        setFotos((f) => [...f, { id: row.id, url: row.url }]);
      }
    } finally {
      setEnviando(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function remover(foto: Foto) {
    setErro(null);
    await supabase.from("portfolio_items").delete().eq("id", foto.id);
    const marcador = "/portfolio/";
    const idx = foto.url.indexOf(marcador);
    if (idx >= 0) await supabase.storage.from("portfolio").remove([foto.url.slice(idx + marcador.length)]);
    setFotos((f) => f.filter((x) => x.id !== foto.id));
  }

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))", gap: 12 }}>
        {fotos.map((foto) => (
          <div key={foto.id} style={{ position: "relative", aspectRatio: "4/3", borderRadius: 12, overflow: "hidden", border: "1px solid var(--line)" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={foto.url} alt="Trabalho" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            <button type="button" onClick={() => remover(foto)} aria-label="Remover foto"
              style={{ position: "absolute", top: 6, right: 6, width: 26, height: 26, borderRadius: "50%", border: "none", background: "rgba(12,30,42,.72)", color: "#fff", cursor: "pointer", fontSize: 15, lineHeight: 1 }}>×</button>
          </div>
        ))}

        <button type="button" onClick={() => inputRef.current?.click()} disabled={enviando}
          style={{ aspectRatio: "4/3", borderRadius: 12, border: "1.5px dashed var(--line)", background: "var(--bg)", color: "var(--ink-faint)", cursor: "pointer", display: "grid", placeItems: "center", fontSize: 13, fontWeight: 600 }}>
          {enviando ? "Enviando..." : "+ Adicionar foto"}
        </button>
      </div>
      <input ref={inputRef} type="file" accept="image/*" multiple onChange={aoEscolher} style={{ display: "none" }} />
      {erro && <p style={{ color: "#b3261e", fontSize: 13.5, marginTop: 10 }}>{erro}</p>}
      <p style={{ color: "var(--ink-faint)", fontSize: 12.5, marginTop: 12 }}>Fotos de trabalhos concluídos ajudam o cliente a confiar. Até 5 MB cada.</p>
    </div>
  );
}
