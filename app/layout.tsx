import type { Metadata } from "next";
import { Barlow_Condensed, Instrument_Sans } from "next/font/google";
import "./globals.css";

const barlow = Barlow_Condensed({
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
  variable: "--font-barlow",
});

const instrument = Instrument_Sans({
  subsets: ["latin"],
  variable: "--font-instrument",
});

export const metadata: Metadata = {
  title: { default: "Matchday", template: "%s | Matchday" },
  description: "Run tournaments and follow the table, from FIFA nights to faculty games.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${barlow.variable} ${instrument.variable}`}>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
