"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { salvarPerfilCliente } from "./actions";
import { formatarTelefone, validarTelefone } from "@/lib/documento";
import { Campo } from "@/components/ui";

export function ClienteForm({ nomeInicial, telefoneInicial }: { nomeInicial: string; telefoneInicial: string }) {
  const router = useRouter();
  const [nome, setNome] = useState(nomeInicial);
  const [telefone, setTelefone] = useState(formatarTelefone(telefoneInicial));
  const [pending, start] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const [salvo, setSalvo] = useState(false);

  const telInvalido = telefone.trim() !== "" && !validarTelefone(telefone);

  function salvar() {
    setErro(null);
    setSalvo(false);
    start(async () => {
      const r = await salvarPerfilCliente({ nome, telefone });
      if (r.ok) { setSalvo(true); router.refresh(); }
      else setErro(r.error);
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <Campo rotulo="Nome completo" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Seu nome" />

      {/* O texto anterior prometia que "o profissional do seu serviço vê seu telefone",
          o que nunca foi verdade: `profile_private` só é legível pelo próprio dono.
          A conversa acontece no chat, e o telefone só sai daqui se as duas partes
          concordarem em trocar contato. */}
      <Campo rotulo="Telefone / WhatsApp" value={telefone} onChange={(e) => setTelefone(formatarTelefone(e.target.value))}
        inputMode="numeric" placeholder="(11) 90000-0000"
        erro={telInvalido ? "Telefone incompleto." : null}
        dica="Seu telefone fica privado — não aparece em página pública nem para o profissional. A conversa acontece pelo chat, e o número só é compartilhado se vocês dois autorizarem." />

      {erro && <p style={{ color: "var(--danger)", fontSize: 14, margin: 0 }}>{erro}</p>}
      {salvo && <p style={{ color: "var(--good)", fontSize: 14, fontWeight: 600, margin: 0 }}>Perfil salvo!</p>}

      <button className="btn btn-primary" onClick={salvar} disabled={pending || telInvalido}
        style={{ alignSelf: "flex-start", opacity: pending ? 0.7 : 1 }}>
        {pending ? "Salvando..." : "Salvar"}
      </button>
    </div>
  );
}
