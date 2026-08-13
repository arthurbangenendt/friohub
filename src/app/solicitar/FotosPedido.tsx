"use client";

import { useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";

/* Fotos do pedido de orçamento.
 *
 * Em climatização, foto vale mais que descrição: o técnico olha o ambiente, o
 * aparelho, a plaqueta de identificação e o quadro elétrico e já sabe metade do
 * que precisa. Sem foto, ou ele chuta alto ou marca visita — e os dois atrasam
 * o cliente.
 *
 * Envia direto para o bucket `orcamentos`, na pasta {uid}/, que é o que as
 * policies de storage exigem. Limite de tipo e tamanho também existe no bucket
 * (8 MB, jpeg/png/webp): a checagem daqui é só para dar erro legível.
 */
const MAX_FOTOS = 6;
const MAX_BYTES = 8 * 1024 * 1024;

export function FotosPedido({
  userId, fotos, onChange,
}: {
  userId: string;
  fotos: string[];
  onChange: (urls: string[]) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function aoEscolher(e: React.ChangeEvent<HTMLInputElement>) {
    const arquivos = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!arquivos.length) return;

    setErro(null);
    const espaco = MAX_FOTOS - fotos.length;
    if (espaco <= 0) return setErro(`Máximo de ${MAX_FOTOS} fotos.`);

    setEnviando(true);
    const supabase = createClient();
    const novas: string[] = [];

    for (const file of arquivos.slice(0, espaco)) {
      if (!file.type.startsWith("image/")) {
        setErro("Envie apenas imagens.");
        continue;
      }
      if (file.size > MAX_BYTES) {
        setErro(`"${file.name}" passa de 8 MB.`);
        continue;
      }
      const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
      const caminho = `${userId}/${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage.from("orcamentos").upload(caminho, file);
      if (error) {
        setErro(error.message);
        continue;
      }
      novas.push(supabase.storage.from("orcamentos").getPublicUrl(caminho).data.publicUrl);
    }

    setEnviando(false);
    if (novas.length) onChange([...fotos, ...novas]);
  }

  return (
    <div style={{ marginTop: 4 }}>
      <span style={{ fontSize: 13, fontWeight: 650, color: "var(--ink-soft)", display: "block", marginBottom: 6 }}>
        Fotos do local (opcional, até {MAX_FOTOS})
      </span>
      <p style={{ fontSize: 12.5, color: "var(--ink-faint)", margin: "0 0 10px" }}>
        Ajuda muito: o ambiente, o aparelho, a plaqueta com o modelo e o quadro de disjuntores.
      </p>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {fotos.map((url) => (
          <div key={url} style={{ position: "relative" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={url} alt="Foto do local"
              style={{ width: 84, height: 84, objectFit: "cover", borderRadius: 10, display: "block" }} />
            <button
              onClick={() => onChange(fotos.filter((f) => f !== url))}
              aria-label="Remover foto"
              style={{
                position: "absolute", top: -6, right: -6, width: 22, height: 22, borderRadius: "50%",
                border: "none", background: "var(--ink)", color: "#fff", cursor: "pointer", fontSize: 13, lineHeight: 1,
              }}
            >
              ×
            </button>
          </div>
        ))}

        {fotos.length < MAX_FOTOS && (
          <button
            onClick={() => inputRef.current?.click()}
            disabled={enviando}
            style={{
              width: 84, height: 84, borderRadius: 10, cursor: "pointer",
              border: "1px dashed var(--line)", background: "var(--surface-2)",
              color: "var(--ink-faint)", fontSize: 12.5,
            }}
          >
            {enviando ? "Enviando…" : "+ Foto"}
          </button>
        )}
      </div>

      <input ref={inputRef} type="file" accept="image/*" multiple onChange={aoEscolher} style={{ display: "none" }} />
      {erro && <p style={{ color: "#b3261e", fontSize: 12.5, margin: "8px 0 0" }}>{erro}</p>}
    </div>
  );
}
