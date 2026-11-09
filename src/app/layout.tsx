import type { Metadata } from "next";
import { IBM_Plex_Mono, Inter } from "next/font/google";
import { lab } from "@/content/lab";
import "./globals.css";

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["500", "700"],
  variable: "--font-plex-mono",
});

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: {
    default: `${lab.name} · ${lab.tagline}`,
    template: `%s · ${lab.name}`,
  },
  description: lab.intro,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${plexMono.variable} ${inter.variable}`}>
      <body>{children}</body>
    </html>
  );
}
