"use client";

import { useLayoutEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { LiquidMetal } from "@paper-design/shaders-react";

const STORAGE_KEY = "friohub-theme";
type Tema = "light" | "dark";

function lerTemaGuardado(): Tema | null {
  if (typeof window === "undefined") return null;
  const guardado = window.localStorage.getItem(STORAGE_KEY);
  return guardado === "light" || guardado === "dark" ? guardado : null;
}

/* Mesma fonte que o script inline em layout.tsx: se nada foi salvo ainda,
   segue a preferência do sistema — o botão só passa a mandar quando o
   visitante decide algo diferente do automático. */
function temaInicial(): Tema {
  if (typeof window === "undefined") return "light";
  return (
    lerTemaGuardado() ??
    (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
  );
}

export function ThemeToggle() {
  const [tema, setTema] = useState<Tema>(temaInicial);
  const [hover, setHover] = useState(false);
  const [pressionado, setPressionado] = useState(false);

  /* O Strict Mode do React em dev remonta o componente e, nesse remount,
     limpa do <html> qualquer atributo que não veio do JSX — inclusive o
     data-theme que o script inline do <head> já tinha aplicado antes do
     paint. Reaplicar aqui é o que o próprio guia do Next recomenda; em
     produção isso não roda de novo, é um no-op. */
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = tema;
  }, [tema]);

  function alternar() {
    const proximo: Tema = tema === "dark" ? "light" : "dark";
    window.localStorage.setItem(STORAGE_KEY, proximo);
    document.documentElement.dataset.theme = proximo;
    setTema(proximo);
  }

  const Icone = tema === "dark" ? Sun : Moon;

  return (
    <button
      type="button"
      onClick={alternar}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => { setHover(false); setPressionado(false); }}
      onMouseDown={() => setPressionado(true)}
      onMouseUp={() => setPressionado(false)}
      aria-label={tema === "dark" ? "Mudar para modo claro" : "Mudar para modo escuro"}
      title={tema === "dark" ? "Modo claro" : "Modo escuro"}
      style={{
        position: "fixed",
        zIndex: 850,
        right: 16,
        bottom: 20,
        width: 46,
        height: 46,
        padding: 0,
        border: "none",
        borderRadius: "50%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: "pointer",
        overflow: "hidden",
        background: "linear-gradient(180deg, #202020 0%, #000000 100%)",
        boxShadow: pressionado
          ? "inset 0px 2px 4px rgba(0,0,0,.4), 0px 0px 0px 1px rgba(0,0,0,.5)"
          : hover
            ? "0px 0px 0px 1px rgba(0,0,0,.4), 0px 8px 20px rgba(0,0,0,.25)"
            : "0px 0px 0px 1px rgba(0,0,0,.3), 0px 4px 14px rgba(0,0,0,.18)",
        transform: pressionado ? "scale(0.96)" : "scale(1)",
        transition: "box-shadow .15s ease, transform .15s ease",
      }}
    >
      <LiquidMetal
        style={{ position: "absolute", inset: 0 }}
        width="100%"
        height="100%"
        colorBack="#000000"
        colorTint="#606060"
        repetition={4}
        softness={0.5}
        shiftRed={0.3}
        shiftBlue={0.3}
        distortion={0}
        contour={0}
        angle={45}
        scale={8}
        shape="circle"
        offsetX={0.1}
        offsetY={-0.1}
        speed={pressionado ? 2.4 : hover ? 1 : 0.6}
      />
      <Icone
        size={16}
        style={{
          position: "relative",
          zIndex: 1,
          color: "#999999",
          filter: "drop-shadow(0px 1px 2px rgba(0,0,0,.5))",
          pointerEvents: "none",
        }}
      />
    </button>
  );
}
