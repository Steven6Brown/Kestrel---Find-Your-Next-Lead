import { Archivo, Inter } from "next/font/google";
import "./globals.css";
import { product } from "@/config/product";

const archivo = Archivo({ subsets: ["latin"], variable: "--font-archivo", display: "swap", weight: ["600", "700", "800"] });
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export const metadata = {
  title: { default: product.name, template: `%s | ${product.name}` },
  description: product.tagline,
  // Internal tool and unlisted concept pages: keep everything out of search results.
  robots: { index: false, follow: false },
};

export const viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function RootLayout({ children }) {
  return (
    <html lang="en" data-scroll-behavior="smooth" className={`${archivo.variable} ${inter.variable}`}>
      <body className="min-h-screen antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:bg-ink focus:px-4 focus:py-3 focus:text-white"
        >
          Skip to main content
        </a>
        {children}
      </body>
    </html>
  );
}
