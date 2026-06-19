import type { Metadata, Viewport } from "next";
import { Fraunces, Hanken_Grotesk } from "next/font/google";
import "./globals.css";

/*
 * Fonts are self-hosted by next/font at build time — no runtime call to Google,
 * keeping the kiosk fully offline-capable (on-prem requirement).
 *
 * Fraunces: the architectural display serif for the wordmark, greetings and big
 * numbers. Hanken Grotesk: the warm UI/body sans. See brand/BRAND.md.
 */
const display = Fraunces({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-display",
  weight: ["400", "500", "600", "700"],
  style: ["normal", "italic"],
});

const sans = Hanken_Grotesk({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sans",
  weight: ["400", "500", "600", "700"],
});

// Generic title — the on-screen wordmark comes from branding, but the document
// title should not leak a hard-coded brand for white-label installs.
export const metadata: Metadata = {
  title: "Gate",
  description: "On-premise face access terminal.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: "#0C0A12",
  // Tablet kiosks mount in fixed orientation next to the door.
  colorScheme: "dark",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="fr" className={`${display.variable} ${sans.variable}`}>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
