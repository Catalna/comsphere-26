import type { Metadata } from "next";
import type { ReactNode } from "react";
import "@fontsource/plus-jakarta-sans/400.css";
import "@fontsource/plus-jakarta-sans/500.css";
import "@fontsource/plus-jakarta-sans/600.css";
import "@fontsource/plus-jakarta-sans/700.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "DanaTerang — Audit Program",
  description: "Jejak bukti dan status program DanaTerang.",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="id">
      <body>
        <a className="skip-link" href="#main">Lewati ke konten</a>
        {children}
      </body>
    </html>
  );
}
