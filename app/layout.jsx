import { Space_Grotesk, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { product } from "@/config/product";

const space = Space_Grotesk({ subsets: ["latin"], variable: "--font-space", display: "swap", weight: ["400", "500", "600", "700"] });
const plex = IBM_Plex_Mono({ subsets: ["latin"], variable: "--font-plex", display: "swap", weight: ["400", "500"] });

export const metadata = {
  title: { default: product.name, template: `%s | ${product.name}` },
  description: product.tagline,
  // Internal tool and unlisted concept pages: keep everything out of search results.
  robots: { index: false, follow: false },
};

export const viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#0b0e13" };

export default function RootLayout({ children }) {
  return (
    <html lang="en" data-scroll-behavior="smooth" className={`${space.variable} ${plex.variable}`}>
      <body className="min-h-screen antialiased">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:bg-brand focus:px-4 focus:py-3 focus:font-semibold focus:text-brand-ink"
        >
          Skip to main content
        </a>
        {children}
      </body>
    </html>
  );
}
