"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatarDocumento, validarDocumento } from "@/lib/documento";
import { salvarCpfCnpjCliente } from "./actions";
import { Campo } from "@/components/ui";

/* CPF/CNPJ do cliente — necessário pro Asaas abrir o pagador na hora de
 * cobrar o serviço. Coleta única, igual à regra do backend
 * (salvarCpfCnpjSeAusente): uma vez salvo, não tem como editar por aqui —
 * mudar depois de vinculado ao gateway trocaria a identidade do pagador de
 * uma cobrança que já pode estar em aberto. */
export function CpfCnpjCliente({ cpfCnpjInicial }: { cpfCnpjInicial: string | null }) {
  const router = useRouter();
  const [valor, setValor] = useState("");
  const [pending, start] = useTransition();
  const [erro, setErro] = useState<string | null>(null);

  const invalido = valor.trim() !== "" && !validarDocumento(valor);

  function salvar() {
    setErro(null);
    start(async () => {
      const r = await salvarCpfCnpjCliente(valor);
      if (r.ok) router.refresh();
      else setErro(r.error);
    });
  }

  if (cpfCnpjInicial) {
    return (
      <Campo rotulo="CPF ou CNPJ" value={formatarDocumento(cpfCnpjInicial)} disabled
        dica="Documento usado pra abrir cobranças no Asaas — não pode ser trocado por aqui." />
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <Campo rotulo="CPF ou CNPJ" value={valor} onChange={(e) => setValor(formatarDocumento(e.target.value))}
        inputMode="numeric" placeholder="000.000.000-00"
        erro={invalido ? "CPF ou CNPJ inválido." : erro}
        dica={invalido || erro ? undefined : "Necessário para pagar um serviço pela plataforma."} />
      <button type="button" className="btn btn-primary" onClick={salvar}
        disabled={pending || !valor || invalido}
        style={{ alignSelf: "flex-start", height: 40, padding: "0 18px", opacity: pending ? 0.7 : 1 }}>
        {pending ? "Salvando..." : "Salvar"}
      </button>
    </div>
  );
}
