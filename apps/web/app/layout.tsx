import type { Metadata } from "next";
import "./globals.css";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://elanguagecenter.com";
const TITLE = "eLanguage Center — Skills That Open Doorways";
const DESCRIPTION =
  "IELTS preparation across Reading, Listening, Writing, and Speaking. AI-generated practice, AI-graded feedback. Free. Fun. Effective.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: TITLE,
    template: "%s | eLanguage Center",
  },
  description: DESCRIPTION,
  applicationName: "eLanguage Center",
  openGraph: {
    title: TITLE,
    description: DESCRIPTION,
    siteName: "eLanguage Center",
    type: "website",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="min-h-full bg-brand-grey-50">
      <body className="min-h-full flex flex-col bg-brand-grey-50">{children}</body>
    </html>
  );
}
