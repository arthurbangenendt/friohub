"use client";

import Script from "next/script";
import { useEffect } from "react";
import { usePathname } from "next/navigation";

const BASE_URL = process.env.NEXT_PUBLIC_CHATWOOT_BASE_URL;
const WEBSITE_TOKEN = process.env.NEXT_PUBLIC_CHATWOOT_WEBSITE_TOKEN;

declare global {
  interface Window {
    chatwootSDK?: { run: (config: { websiteToken: string; baseUrl: string }) => void };
    $chatwoot?: { toggleBubbleVisibility: (state: "show" | "hide") => void };
  }
}

/* Painel e admin já têm o chat próprio cliente↔profissional — o widget é só
   para visitante do site público. */
function escondidoEm(pathname: string | null) {
  if (!pathname) return false;
  return pathname.startsWith("/painel") || pathname.startsWith("/admin");
}

export function ChatwootWidget() {
  const pathname = usePathname();

  useEffect(() => {
    if (!BASE_URL || !WEBSITE_TOKEN) return;
    const estado = escondidoEm(pathname) ? "hide" : "show";
    window.$chatwoot?.toggleBubbleVisibility(estado);
    /* $chatwoot só existe depois desse evento — run() só enfileira a inicialização,
       então a primeira troca de visibilidade (antes do evento) não tem efeito
       sozinha; este listener cobre esse caso. */
    const aoFicarPronto = () => window.$chatwoot?.toggleBubbleVisibility(estado);
    window.addEventListener("chatwoot:ready", aoFicarPronto);
    return () => window.removeEventListener("chatwoot:ready", aoFicarPronto);
  }, [pathname]);

  if (!BASE_URL || !WEBSITE_TOKEN) return null;

  return (
    <Script
      src={`${BASE_URL}/packs/js/sdk.js`}
      strategy="afterInteractive"
      onLoad={() => {
        window.chatwootSDK?.run({ websiteToken: WEBSITE_TOKEN, baseUrl: BASE_URL });
      }}
    />
  );
}
