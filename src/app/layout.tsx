import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { REGIAO_LABEL } from "@/lib/regiao";
import "./globals.css";

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
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
