"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Avatar } from "./Avatar";
import { removerMidiaPerfil, salvarMidiaPerfil } from "./perfil/actions";

const MAX_MB = 5;

type Alvo = "avatar" | "banner";

const FORMATOS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
};

/* Avatar e banner são 1:1 e substituíveis — diferente do portfólio, que
   acumula. Por isso o arquivo antigo é removido do storage depois que o novo
   entra: sem isso o bucket cresce para sempre a cada troca de foto.

   Segue o mesmo padrão de upload do PortfolioEditor (valida tipo e tamanho,
   grava em {uid}/ e usa a URL pública). */
export function MidiaEditor({
  uid, nome, avatarUrl, bannerUrl, mostrarBanner, bannerHabilitado = true,
}: {
  uid: string;
  nome: string;
  avatarUrl: string | null;
  bannerUrl: string | null;
  mostrarBanner: boolean;
  bannerHabilitado?: boolean;
}) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const [avatar, setAvatar] = useState(avatarUrl);
  const [banner, setBanner] = useState(bannerUrl);
  const [enviando, setEnviando] = useState<Alvo | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const refAvatar = useRef<HTMLInputElement>(null);
  const refBanner = useRef<HTMLInputElement>(null);

  // Remove do bucket o arquivo apontado por uma URL pública nossa.
  async function removerAntigo(url: string | null) {
    if (!url) return;
    const marcador = "/perfil/";
    const idx = url.indexOf(marcador);
    if (idx < 0) return;
    await supabase.storage.from("perfil").remove([url.slice(idx + marcador.length)]);
  }

  async function enviar(alvo: Alvo, file: File) {
    setErro(null);
    if (alvo === "banner" && !bannerHabilitado) {
      setErro("Salve primeiro as informações do perfil profissional.");
      return;
    }
    const ext = FORMATOS[file.type];
    if (!ext) { setErro("Use uma imagem JPG, PNG, WebP ou AVIF."); return; }
    if (file.size > MAX_MB * 1024 * 1024) { setErro(`A imagem deve ter até ${MAX_MB} MB.`); return; }

    setEnviando(alvo);
    try {
      const path = `${uid}/${alvo}-${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage.from("perfil").upload(path, file, {
        cacheControl: "31536000",
        contentType: file.type,
      });
      if (upErr) { setErro(upErr.message); return; }

      const { data: pub } = supabase.storage.from("perfil").getPublicUrl(path);
      const salvo = await salvarMidiaPerfil(alvo, pub.publicUrl);

      if (!salvo.ok) {
        // Não deixa arquivo órfão no bucket quando a gravação da URL falha.
        await supabase.storage.from("perfil").remove([path]);
        setErro(salvo.error);
        return;
      }

      const antigo = alvo === "avatar" ? avatar : banner;
      if (alvo === "avatar") setAvatar(pub.publicUrl); else setBanner(pub.publicUrl);
      await removerAntigo(antigo);
      router.refresh();
    } finally {
      setEnviando(null);
      if (refAvatar.current) refAvatar.current.value = "";
      if (refBanner.current) refBanner.current.value = "";
    }
  }

  async function limpar(alvo: Alvo) {
    setErro(null);
    const atual = alvo === "avatar" ? avatar : banner;
    const removido = await removerMidiaPerfil(alvo);
    if (!removido.ok) { setErro(removido.error); return; }
    if (alvo === "avatar") setAvatar(null); else setBanner(null);
    await removerAntigo(atual);
    router.refresh();
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {mostrarBanner && (
        <div>
          <span style={rotulo}>Banner do perfil</span>
          <div style={{
            marginTop: 8, height: 132, borderRadius: 14, overflow: "hidden", position: "relative",
            border: "1px solid var(--line)",
            background: banner ? "var(--surface-2)" : "linear-gradient(155deg, #0e1b26 0%, #123243 60%, #0d2130 100%)",
          }}>
            {banner && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={banner} alt="Banner do perfil" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
            )}
            <div style={{ position: "absolute", right: 10, bottom: 10, display: "flex", gap: 8 }}>
              <button type="button" onClick={() => refBanner.current?.click()} disabled={enviando !== null || !bannerHabilitado}
                aria-describedby={!bannerHabilitado ? "banner-bloqueado" : undefined}
                style={{ ...btnSobre, opacity: bannerHabilitado ? 1 : .65, cursor: bannerHabilitado ? "pointer" : "not-allowed" }}>
                {enviando === "banner" ? "Enviando..." : banner ? "Trocar" : "Adicionar banner"}
              </button>
              {banner && <button type="button" onClick={() => limpar("banner")} style={btnSobre}>Remover</button>}
            </div>
          </div>
          <input ref={refBanner} type="file" accept="image/*" style={{ display: "none" }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) enviar("banner", f); }} />
          <span id={!bannerHabilitado ? "banner-bloqueado" : undefined} style={dica}>
            {bannerHabilitado
              ? "Aparece no topo do seu perfil público. Use uma imagem larga (1200×300 ou similar)."
              : "Salve as informações profissionais abaixo para liberar o banner."}
          </span>
        </div>
      )}

      <div>
        <span style={rotulo}>Foto de perfil</span>
        <div style={{ display: "flex", alignItems: "center", gap: 16, marginTop: 8 }}>
          <Avatar nome={nome} id={uid} url={avatar} size={72} fontSize={26} />
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" onClick={() => refAvatar.current?.click()} disabled={enviando !== null} className="btn btn-ghost" style={{ height: 38, padding: "0 14px", fontSize: 13.5 }}>
              {enviando === "avatar" ? "Enviando..." : avatar ? "Trocar foto" : "Enviar foto"}
            </button>
            {avatar && (
              <button type="button" onClick={() => limpar("avatar")} className="btn btn-ghost" style={{ height: 38, padding: "0 14px", fontSize: 13.5 }}>
                Remover
              </button>
            )}
          </div>
        </div>
        <input ref={refAvatar} type="file" accept="image/*" style={{ display: "none" }}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) enviar("avatar", f); }} />
        <span style={dica}>Sem foto, mostramos suas iniciais. Até {MAX_MB} MB.</span>
      </div>

      {erro && <p style={{ color: "var(--danger)", fontSize: 13.5, margin: 0 }}>{erro}</p>}
    </div>
  );
}

const rotulo: React.CSSProperties = { fontSize: 13.5, fontWeight: 650, color: "var(--ink-soft)" };
const dica: React.CSSProperties = { display: "block", fontSize: 12.5, color: "var(--ink-faint)", marginTop: 8 };
const btnSobre: React.CSSProperties = {
  height: 32, padding: "0 12px", borderRadius: 8, border: "1px solid rgba(255,255,255,.28)",
  background: "rgba(12,30,42,.6)", color: "#fff", fontSize: 12.5, fontWeight: 600, cursor: "pointer",
  backdropFilter: "blur(4px)",
};
