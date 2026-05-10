import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "eLanguage Center — Skills That Open Doorways",
  description:
    "IELTS preparation across Reading, Listening, Writing, and Speaking. Free. Fun. Effective.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
