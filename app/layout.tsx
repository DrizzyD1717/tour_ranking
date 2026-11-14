import type { Metadata } from "next";
import { Barlow_Condensed, Instrument_Sans } from "next/font/google";
import SiteHeader from "./components/SiteHeader";
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

const DESCRIPTION = "Run tournaments and follow the table, from FIFA nights to faculty games.";

export const metadata: Metadata = {
  // Set NEXT_PUBLIC_SITE_URL (e.g. https://matchday.vercel.app) so share previews use absolute links.
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"),
  title: { default: "Matchday", template: "%s | Matchday" },
  description: DESCRIPTION,
  openGraph: { siteName: "Matchday", type: "website", title: "Matchday", description: DESCRIPTION },
  twitter: { card: "summary", title: "Matchday", description: DESCRIPTION },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${barlow.variable} ${instrument.variable}`}>
      <body className="min-h-dvh">
        <SiteHeader />
        {children}
      </body>
    </html>
  );
}
