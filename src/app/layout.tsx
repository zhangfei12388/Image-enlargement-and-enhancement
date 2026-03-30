import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Image Enlargement & Enhancement",
  description: "Browser-based image enlargement and enhancement tool with AI models running locally",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
