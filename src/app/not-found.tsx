import Link from "next/link";

/* O projeto não tinha 404 próprio — link velho ou id inexistente caía na tela
   padrão do Next, em inglês e sem saída. */
export default function NaoEncontrado() {
  return (
    <main
      id="conteudo"
      style={{ minHeight: "70dvh", display: "grid", placeItems: "center", padding: "60px 24px" }}
    >
      <div style={{ maxWidth: 520, textAlign: "center" }}>
        <p style={{ fontFamily: "var(--font-geist-mono), ui-monospace, monospace", fontSize: 13, letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--cool)" }}>
          Erro 404
        </p>
        <h1 style={{ fontSize: "2rem", fontWeight: 800, letterSpacing: "-0.025em", marginTop: 12 }}>
          Esta página não existe
        </h1>
        <p style={{ color: "var(--ink-soft)", marginTop: 12, lineHeight: 1.6 }}>
          O endereço pode ter mudado, ou o item que você procura foi removido.
        </p>
        <div style={{ display: "flex", gap: 10, marginTop: 26, justifyContent: "center", flexWrap: "wrap" }}>
          <Link href="/" className="btn btn-primary">Ir para o início</Link>
          <Link href="/painel" className="btn btn-ghost">Ir para o painel</Link>
        </div>
      </div>
    </main>
  );
}
