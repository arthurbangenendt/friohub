"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { salvarDocumentoVerificacao, type TipoDocumentoVerificacao } from "./actions";

const MAX_MB = 10;

const FORMATOS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "application/pdf": "pdf",
};

const TIPOS: { valor: TipoDocumentoVerificacao; label: string }[] = [
  { valor: "cnh", label: "CNH" },
  { valor: "rg", label: "RG" },
  { valor: "crea_cft", label: "Registro CREA/CFT" },
  { valor: "cartao_cnpj", label: "Cartão CNPJ" },
];

/* Documento que dá lastro ao selo "verificado" — bucket privado
 * (`documentos-verificacao`), só o dono e o admin conseguem ler (RLS via
 * `pode_ler_documento_verificacao`, 20260824110000). Mesmo esqueleto de
 * upload do MidiaEditor: sobe direto do navegador, só o path final vai pro
 * banco via server action. */
export function DocumentoVerificacao({
  status, tipoEnviado, enviadoEm,
}: {
  status: "pendente" | "em_analise" | "verificado" | "rejeitado";
  tipoEnviado: TipoDocumentoVerificacao | null;
  enviadoEm: string | null;
}) {
  const supabase = useMemo(() => createClient(), []);
  const router = useRouter();
  const [tipo, setTipo] = useState<TipoDocumentoVerificacao>(tipoEnviado ?? "cnh");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);

  async function enviar(file: File) {
    setErro(null);
    const ext = FORMATOS[file.type];
    if (!ext) { setErro("Envie uma imagem (JPG, PNG) ou um PDF."); return; }
    if (file.size > MAX_MB * 1024 * 1024) { setErro(`O arquivo deve ter até ${MAX_MB} MB.`); return; }

    setEnviando(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setErro("Sessão expirada — recarregue a página."); return; }

      const path = `${user.id}/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("documentos-verificacao")
        .upload(path, file, { contentType: file.type });
      if (upErr) { setErro(upErr.message); return; }

      const salvo = await salvarDocumentoVerificacao(tipo, path);
      if (!salvo.ok) {
        await supabase.storage.from("documentos-verificacao").remove([path]);
        setErro(salvo.error);
        return;
      }
      router.refresh();
    } finally {
      setEnviando(false);
      if (ref.current) ref.current.value = "";
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <div style={{ fontSize: 12.5, fontWeight: 650, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--ink-faint)", marginBottom: 4 }}>
          Documento de verificação
        </div>
        <p style={{ color: "var(--ink-soft)", fontSize: 14, margin: 0 }}>
          Precisa disso pra liberar o selo de verificado e aparecer nas
          buscas. Fica privado — só você e a equipe FrioHub veem.
        </p>
      </div>

      {status === "verificado" && tipoEnviado ? (
        <p style={{ margin: 0, fontSize: 13.5, color: "var(--good)", fontWeight: 600 }}>
          Documento aprovado ({TIPOS.find((t) => t.valor === tipoEnviado)?.label}).
        </p>
      ) : (
        <>
          {tipoEnviado && (
            <p style={{ margin: 0, fontSize: 13.5, color: status === "rejeitado" ? "var(--danger)" : "var(--warm)" }}>
              {status === "rejeitado"
                ? "Documento não aprovado — envie um novo."
                : `${TIPOS.find((t) => t.valor === tipoEnviado)?.label} enviado${enviadoEm ? ` em ${new Date(enviadoEm).toLocaleDateString("pt-BR")}` : ""}, em análise.`}
            </p>
          )}

          <label style={{ display: "flex", flexDirection: "column", gap: 6, maxWidth: 260 }}>
            <span style={{ fontSize: 13, fontWeight: 650, color: "var(--ink-soft)" }}>Tipo de documento</span>
            <select value={tipo} onChange={(e) => setTipo(e.target.value as TipoDocumentoVerificacao)}
              style={{ height: 40, padding: "0 12px", borderRadius: 10, border: "1px solid var(--line)", background: "var(--bg)", color: "var(--ink)", fontSize: 14 }}>
              {TIPOS.map((t) => <option key={t.valor} value={t.valor}>{t.label}</option>)}
            </select>
          </label>

          <div>
            <button type="button" onClick={() => ref.current?.click()} disabled={enviando}
              className="btn btn-primary" style={{ height: 40, padding: "0 18px", fontSize: 14, opacity: enviando ? 0.7 : 1 }}>
              {enviando ? "Enviando..." : tipoEnviado ? "Enviar novo documento" : "Enviar documento"}
            </button>
            <input ref={ref} type="file" accept="image/jpeg,image/png,application/pdf" style={{ display: "none" }}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) enviar(f); }} />
          </div>
        </>
      )}

      {erro && <p style={{ color: "var(--danger)", fontSize: 13.5, margin: 0 }}>{erro}</p>}
    </div>
  );
}
