import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"),
  title: "Dois — Finanças de Kim & Alexandre",
  description: "Entradas, gastos, patrimônio e planos do casal em um só lugar.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
  openGraph: {
    title: "Dois — Finanças em conjunto",
    description: "Entradas, gastos, patrimônio e planos do casal em um só lugar.",
    images: [{ url: "/og.png", width: 1200, height: 675, alt: "Dois — Finanças em conjunto, sem complicação." }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Dois — Finanças em conjunto",
    description: "Entradas, gastos, patrimônio e planos do casal em um só lugar.",
    images: ["/og.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>{children}</body>
    </html>
  );
}
