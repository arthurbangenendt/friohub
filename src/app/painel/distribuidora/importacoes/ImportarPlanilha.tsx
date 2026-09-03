"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Alert } from "@/components/ui";
import { gerarModeloPlanilha, parsearPlanilhaImportacao, type ItemPlanilha } from "@/lib/csv-importacao";
import { importarPlanilha } from "./actions";

/* Upload manual de planilha — pra distribuidora que não tem ERP/API pra
 * conectar em Integrações. Mesmo staging/validação/preview de sempre por
 * baixo: só troca COMO os itens entram (ver actions.ts). */
export function ImportarPlanilha() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [nomeArquivo, setNomeArquivo] = useState<string | null>(null);
  const [itens, setItens] = useState<ItemPlanilha[]>([]);
  const [errosParse, setErrosParse] = useState<string[]>([]);
  const [erroEnvio, setErroEnvio] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function baixarModelo() {
    const blob = new Blob([gerarModeloPlanilha()], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "modelo-importacao-friohub.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function selecionarArquivo(file: File) {
    setErroEnvio(null);
    setNomeArquivo(file.name);
    const texto = await file.text();
    const resultado = parsearPlanilhaImportacao(texto);
    setItens(resultado.itens);
    setErrosParse(resultado.erros);
  }

  function enviar() {
    setErroEnvio(null);
    startTransition(async () => {
      const r = await importarPlanilha(itens);
      if (!r.ok) return setErroEnvio(r.error);
      setNomeArquivo(null);
      setItens([]);
      setErrosParse([]);
      if (inputRef.current) inputRef.current.value = "";
      router.push(`/painel/distribuidora/importacoes/${r.batchId}`);
    });
  }

  return (
    <div className="card" style={{ padding: 22, display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <strong style={{ fontSize: 15.5 }}>Importar por planilha</strong>
        <p style={{ fontSize: 13.5, color: "var(--ink-soft)", margin: "4px 0 0", lineHeight: 1.6 }}>
          Sem sistema próprio pra conectar em Integrações? Baixe o modelo, preencha no Excel ou Google Sheets, e suba
          o arquivo aqui. Passa pela mesma revisão antes de entrar no catálogo.
        </p>
      </div>

      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <button type="button" onClick={baixarModelo} className="btn"
          style={{ height: 38, padding: "0 14px", fontSize: 13.5, border: "1px solid var(--line)", background: "var(--surface)" }}>
          Baixar modelo (.csv)
        </button>
        <button type="button" onClick={() => inputRef.current?.click()} className="btn"
          style={{ height: 38, padding: "0 14px", fontSize: 13.5, border: "1px solid var(--line)", background: "var(--surface)" }}>
          {nomeArquivo ?? "Escolher arquivo…"}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".csv,text/csv"
          style={{ display: "none" }}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) selecionarArquivo(f); }}
        />
      </div>

      {nomeArquivo && itens.length === 0 && errosParse.length > 0 && (
        <Alert tipo="erro">{errosParse[0]}</Alert>
      )}

      {itens.length > 0 && (
        <>
          <Alert tipo={errosParse.length > 0 ? "aviso" : "info"}>
            {itens.length} {itens.length === 1 ? "linha pronta" : "linhas prontas"} pra importar.
            {errosParse.length > 0 && ` ${errosParse.length} linha${errosParse.length === 1 ? "" : "s"} com problema — confira o resultado depois de enviar.`}
          </Alert>
          <div>
            <button className="btn btn-primary" onClick={enviar} disabled={pending}>
              {pending ? "Enviando…" : `Enviar ${itens.length} ${itens.length === 1 ? "item" : "itens"}`}
            </button>
          </div>
        </>
      )}

      {erroEnvio && <Alert tipo="erro">{erroEnvio}</Alert>}

      <p style={{ fontSize: 12.5, color: "var(--ink-faint)", margin: 0 }}>
        Categoria aceita exatamente: split, inverter, multi_split, piso_teto ou janela. O código do produto é um
        identificador que você escolhe (pode ser o próprio modelo) — usamos ele pra saber se uma próxima importação é
        produto novo ou atualização do mesmo item.
      </p>
    </div>
  );
}
