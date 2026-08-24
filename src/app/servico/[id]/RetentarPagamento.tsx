"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { tentarNovamenteCobranca } from "./actions";

/* Botão de retry pra quando a cobrança nunca foi gerada (ou falhou best-
 * effort no aceite da proposta — `asaas-cobrar-servico` é chamado ali sem
 * travar o aceite, então o cliente pode chegar aqui sem nenhuma cobrança
 * de verdade no Asaas). Sem isso o cliente ficava vendo "Aguardando
 * emissão" pra sempre, sem nenhuma ação disponível — achado testando o
 * fluxo real em produção. */
export function RetentarPagamento({ jobId }: { jobId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [erro, setErro] = useState<string | null>(null);

  const semCpfCnpj = erro?.toLowerCase().includes("cpf") || erro?.toLowerCase().includes("cnpj");

  function tentar() {
    setErro(null);
    start(async () => {
      const r = await tentarNovamenteCobranca(jobId);
      if (r.ok) router.refresh();
      else setErro(r.error);
    });
  }

  return (
    <div style={{ display: "grid", gap: 8 }}>
      <button type="button" className="btn btn-primary" onClick={tentar} disabled={pending}
        style={{ justifySelf: "start", opacity: pending ? 0.7 : 1 }}>
        {pending ? "Gerando cobrança..." : "Gerar cobrança"}
      </button>
      {erro && (
        <p style={{ margin: 0, fontSize: 13, color: "var(--danger)" }}>
          {erro}
          {semCpfCnpj && (
            <>
              {" "}
              <Link href="/painel/perfil-cliente" style={{ fontWeight: 600 }}>Cadastrar no perfil</Link>.
            </>
          )}
        </p>
      )}
    </div>
  );
}
