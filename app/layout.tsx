import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "500", "600"],
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "ARC — Autonomous Rescue Cluster",
  description:
    "Gemma 4-powered post-disaster autonomous rescue swarm. Air-ground heterogeneous networks for the golden window of life-saving.",
};

export const viewport: Viewport = {
  themeColor: "#0a0b0d",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={inter.variable}>
      <head>
        {/* Re-add this preload once /public/hero-poster.webp is produced —
            preloading a missing asset 404s on every page load. */}
        {/* <link
          rel="preload"
          as="image"
          href="/hero-poster.webp"
          fetchPriority="high"
        /> */}
      </head>
      <body>{children}</body>
    </html>
  );
}
