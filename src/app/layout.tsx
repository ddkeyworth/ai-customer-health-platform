import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { Suspense } from "react";
import "./globals.css";
import Sidebar from "@/components/Sidebar";
import TopBar from "@/components/TopBar";
import AppShell from "@/components/AppShell";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "ai-customer-health-platform (work in progress)",
  description:
    "Conceptual exploration of an agentic-AI Customer Success platform. Not a real product – see README for scope and safety principles.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${inter.variable} h-full antialiased`}
    >
      <body className="min-h-full flex bg-zinc-50 text-zinc-900 font-sans">
        <AppShell
          sidebar={
            <Suspense fallback={null}>
              <Sidebar />
            </Suspense>
          }
          topbar={<TopBar />}
        >
          {children}
        </AppShell>
      </body>
    </html>
  );
}
