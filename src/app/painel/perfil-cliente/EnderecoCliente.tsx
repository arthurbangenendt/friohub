"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatarCep } from "@/lib/cep";
import { salvarEnderecoCliente } from "./actions";

const campo: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 7 };
const rotulo: React.CSSProperties = { fontSize: 13.5, fontWeight: 650, color: "var(--ink-soft)" };
const input: React.CSSProperties = { height: 44, padding: "0 14px", borderRadius: 10, border: "1px solid var(--line)", background: "var(--bg)", color: "var(--ink)", fontSize: 15, width: "100%" };

/* Endereço salvo no perfil — pré-preenche o CEP em /solicitar e o campo de
 * endereço completo na hora de aceitar uma proposta (antes disso,
 * `enderecoSugerido` era sempre string vazia; o cliente sempre editava do
 * zero). Ao contrário do CPF/CNPJ, é sempre editável: endereço muda. */
export function EnderecoCliente({
  cepInicial, bairroInicial, enderecoCompletoInicial,
}: {
  cepInicial: string;
  bairroInicial: string;
  enderecoCompletoInicial: string;
}) {
  const router = useRouter();
  const [cep, setCep] = useState(formatarCep(cepInicial));
  const [bairro, setBairro] = useState(bairroInicial);
  const [enderecoCompleto, setEnderecoCompleto] = useState(enderecoCompletoInicial);
  const [pending, start] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const [salvo, setSalvo] = useState(false);

  const cepDigitos = cep.replace(/\D/g, "");
  const cepInvalido = cepDigitos.length > 0 && cepDigitos.length !== 8;

  function salvar() {
    setErro(null);
    setSalvo(false);
    start(async () => {
      const r = await salvarEnderecoCliente({ cep: cepDigitos, bairro, enderecoCompleto });
      if (r.ok) { setSalvo(true); router.refresh(); }
      else setErro(r.error);
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ fontSize: 12.5, fontWeight: 650, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--ink-faint)" }}>
        Endereço
      </div>
      <p style={{ margin: 0, fontSize: 13, color: "var(--ink-soft)" }}>
        Usado pra sugerir o CEP quando você pedir um serviço novo e o
        endereço completo na hora de aceitar uma proposta — sempre editável
        em cada pedido.
      </p>

      <label style={campo}>
        <span style={rotulo}>CEP</span>
        <input value={cep} onChange={(e) => setCep(formatarCep(e.target.value))}
          inputMode="numeric" placeholder="00000-000" style={input} />
        {cepInvalido && <span style={{ fontSize: 12.5, color: "var(--danger)" }}>CEP incompleto.</span>}
      </label>

      <label style={campo}>
        <span style={rotulo}>Bairro</span>
        <input value={bairro} onChange={(e) => setBairro(e.target.value)} placeholder="Bairro" style={input} />
      </label>

      <label style={campo}>
        <span style={rotulo}>Endereço completo</span>
        <input value={enderecoCompleto} onChange={(e) => setEnderecoCompleto(e.target.value)}
          placeholder="Rua, número, complemento" style={input} />
      </label>

      {erro && <p style={{ color: "var(--danger)", fontSize: 14, margin: 0 }}>{erro}</p>}
      {salvo && <p style={{ color: "var(--good)", fontSize: 14, fontWeight: 600, margin: 0 }}>Endereço salvo!</p>}

      <button className="btn btn-primary" onClick={salvar} disabled={pending || cepInvalido}
        style={{ alignSelf: "flex-start", opacity: pending ? 0.7 : 1 }}>
        {pending ? "Salvando..." : "Salvar"}
      </button>
    </div>
  );
}
