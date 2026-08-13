"use client";

import { useState, useTransition } from "react";
import { autorizarContato, buscarContato, type Contato } from "../actions";

/* Card de troca de contato.
 *
 * Só é renderizado quando `handoff_liberado` já é verdadeiro no banco (conversa
 * frequente por 4 dias com troca dos dois lados, ou serviço fechado). Mesmo
 * assim o telefone não aparece: cada lado precisa autorizar, e quem entrega o
 * número é a função `revelar_contato` — nunca uma leitura direta de
 * `profile_private`, que continua restrita ao dono.
 */
export function Handoff({
  conversaId, outroNome, jaAutorizei, ambosAutorizaram, motivo,
}: {
  conversaId: string;
  outroNome: string;
  jaAutorizei: boolean;
  ambosAutorizaram: boolean;
  /** Por que o handoff liberou. O texto precisa dizer a verdade: dizer
   *  "vocês já conversam há alguns dias" para quem acabou de abrir a conversa
   *  (e liberou por ter serviço fechado) faz o produto parecer quebrado. */
  motivo: "servico" | "conversa";
}) {
  const [autorizado, setAutorizado] = useState(jaAutorizei);
  const [contato, setContato] = useState<Contato | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function autorizar() {
    setErro(null);
    startTransition(async () => {
      const r = await autorizarContato(conversaId);
      if (!r.ok) return setErro(r.error);
      setAutorizado(true);
      // Se a outra pessoa já tinha autorizado, o número sai na mesma ação.
      const c = await buscarContato(conversaId);
      if (c.ok) setContato(c.contato);
    });
  }

  function ver() {
    setErro(null);
    startTransition(async () => {
      const c = await buscarContato(conversaId);
      if (c.ok) setContato(c.contato);
      else setErro(c.error);
    });
  }

  return (
    <div style={{ padding: "18px 20px", borderRadius: 16, background: "var(--cool-wash)", border: "1px solid var(--line)" }}>
      <strong style={{ fontSize: 15 }}>Continuar pelo WhatsApp?</strong>

      {contato ? (
        <div style={{ marginTop: 10 }}>
          <p style={{ fontSize: 14, color: "var(--ink-soft)", margin: "0 0 12px" }}>
            {contato.nome ?? outroNome} · {contato.telefone ?? "telefone não cadastrado"}
          </p>
          {contato.whatsappUrl && (
            <a href={contato.whatsappUrl} target="_blank" rel="noopener noreferrer"
              className="btn btn-primary" style={{ height: 40, padding: "0 16px", fontSize: 14 }}>
              Abrir no WhatsApp
            </a>
          )}
        </div>
      ) : (
        <>
          <p style={{ fontSize: 14, color: "var(--ink-soft)", margin: "6px 0 14px", lineHeight: 1.5 }}>
            {autorizado
              ? `Você autorizou. O número aparece assim que ${outroNome} também autorizar.`
              : `${motivo === "servico"
                  ? `Vocês já têm um serviço fechado.`
                  : `Vocês já conversam há alguns dias.`} Se quiserem trocar telefone, os dois precisam autorizar — o seu número não é compartilhado sem isso.`}
          </p>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {!autorizado && (
              <button className="btn btn-primary" onClick={autorizar} disabled={pending}
                style={{ height: 40, padding: "0 16px", fontSize: 14 }}>
                {pending ? "Autorizando…" : "Autorizar troca de contato"}
              </button>
            )}
            {autorizado && ambosAutorizaram && (
              <button className="btn btn-primary" onClick={ver} disabled={pending}
                style={{ height: 40, padding: "0 16px", fontSize: 14 }}>
                Ver contato
              </button>
            )}
          </div>
        </>
      )}

      {erro && <p style={{ color: "#b3261e", fontSize: 13, margin: "10px 0 0" }}>{erro}</p>}
    </div>
  );
}
