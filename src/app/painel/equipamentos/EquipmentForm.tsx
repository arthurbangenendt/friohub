"use client";
import { useActionState } from "react";
import { adicionarEquipamento, type EquipmentState } from "./actions";
import { Campo } from "@/components/ui";

const initial: EquipmentState = { ok: false, message: "" };

/* Os campos usavam só `placeholder` como rótulo. Isso some assim que a pessoa
   começa a digitar — ou seja, quem for conferir "qual campo é este?" no meio do
   preenchimento não tem resposta — e não é lido de forma confiável por leitor de
   tela. `Campo` obriga o rótulo a existir. */
export function EquipmentForm() {
  const [state, action, pending] = useActionState(adicionarEquipamento, initial);
  return (
    <form
      action={action}
      className="card"
      style={{
        padding: 20,
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))",
        gap: 10,
      }}
    >
      <h2 style={{ gridColumn: "1/-1", fontSize: 16 }}>Adicionar equipamento</h2>
      <Campo rotulo="Nome do local" name="label" required minLength={2} placeholder="Casa, Loja, Sala 2…" />
      <Campo rotulo="Endereço" name="address" required minLength={5} placeholder="Rua, número" />
      <Campo rotulo="CEP" name="cep" inputMode="numeric" placeholder="00000-000" />
      <Campo rotulo="Marca" name="brand" placeholder="Ex.: Springer" />
      <Campo rotulo="Modelo" name="model" placeholder="Ex.: Midea Xtreme" />
      <Campo rotulo="Capacidade (BTU)" name="capacity" type="number" min={1000} max={200000} placeholder="12000" />
      <Campo rotulo="Data de instalação" name="installedAt" type="date" />
      <button className="btn btn-primary" disabled={pending}>
        {pending ? "Salvando…" : "Adicionar"}
      </button>
      {state.message && (
        <p role="status" style={{ gridColumn: "1/-1", color: state.ok ? "var(--good)" : "var(--danger)" }}>
          {state.message}
        </p>
      )}
    </form>
  );
}
