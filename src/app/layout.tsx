import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { REGIAO_LABEL } from "@/lib/regiao";
import "./globals.css";
import { AnalyticsConsent } from "@/components/AnalyticsConsent";
import { ChatwootWidget } from "@/components/ChatwootWidget";
import { ThemeToggle } from "@/components/ThemeToggle";
import { ToastProvider } from "@/components/ui";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/* É o que aparece no Google e em link compartilhado — precisa cobrir os serviços
   que a plataforma de fato oferece, não só instalação. */
export const metadata: Metadata = {
  title: "FrioHub — instalação, manutenção, limpeza e conserto de ar-condicionado",
  description:
    `Instale, limpe, conserte ou remaneje seu ar-condicionado em ${REGIAO_LABEL}. Escolha o profissional pelo perfil e pela avaliação por especialidade. Se o aparelho for novo, compre do catálogo com entrega em casa.`,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="pt-BR"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        {/* Lê a preferência salva e escreve data-theme no <html> antes do
            primeiro paint — sem isso, quem escolheu modo escuro veria um
            flash de tela clara a cada carregamento. Roda de forma síncrona
            durante o parsing do HTML, antes até da hidratação do React (ver
            node_modules/next/dist/docs/01-app/02-guides/preventing-flash-before-hydration.md). */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem("friohub-theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t;}catch(e){}})();`,
          }}
        />
      </head>
      {/* Extensões de navegador (ColorZilla, gerenciadores de senha) injetam
          atributos no body antes da hidratação e disparam mismatch. O className
          aqui é literal fixo, então suprimir o aviso deste elemento — e só dele,
          um nível — não esconde nenhum descompasso real nosso. */}
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        {/* Só aparece ao receber foco pelo teclado. Primeiro elemento tabulável
            da página de propósito: é o atalho para pular a navegação. */}
        <a href="#conteudo" className="skip-link">Pular para o conteúdo</a>
        <ToastProvider>{children}</ToastProvider>
        <AnalyticsConsent />
        <ChatwootWidget />
        <ThemeToggle />
      </body>
    </html>
  );
}
