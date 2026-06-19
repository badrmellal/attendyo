import type { Metadata, Viewport } from "next";
import { Fraunces, Hanken_Grotesk } from "next/font/google";
import "./globals.css";
import { BrandingProvider } from "@/components/BrandingProvider";

// Display serif (headings, wordmark, big numbers) and body/UI sans, per brand/BRAND.md.
const display = Fraunces({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  style: ["normal", "italic"],
  variable: "--font-display",
  display: "swap",
});

const sans = Hanken_Grotesk({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-sans",
  display: "swap",
});

// The product is white-label; the generic title is overwritten client-side from
// branding tokens. We keep a neutral default rather than hard-coding a brand.
export const metadata: Metadata = {
  title: "Console — Access & Attendance",
  description:
    "On-premise face attendance and access control. Sold once, owned forever, runs on your own LAN.",
  robots: { index: false, follow: false },
  icons: { icon: "/favicon.svg" },
};

export const viewport: Viewport = {
  themeColor: "#0C0A12",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // Default lang/dir is fr; BrandingProvider updates them once tokens load.
  return (
    <html
      lang="fr"
      dir="ltr"
      data-theme="dark"
      className={`${display.variable} ${sans.variable}`}
      suppressHydrationWarning
    >
      <body className="font-sans antialiased">
        <BrandingProvider>{children}</BrandingProvider>
      </body>
    </html>
  );
}
