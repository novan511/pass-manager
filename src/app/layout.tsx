import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Keyring — Shared Password Manager",
    template: "%s · Keyring",
  },
  description:
    "Zero-knowledge password manager for teams. Encrypted vaults, passkeys, TOTP, and browser autofill.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem("keyring-theme");if(t!=="light"&&t!=="dark"&&t!=="system")t="system";var r=t;if(t==="system"){r=(window.matchMedia&&window.matchMedia("(prefers-color-scheme: light)").matches)?"light":"dark"}document.documentElement.setAttribute("data-theme",r);document.documentElement.setAttribute("data-theme-pref",t)}catch(e){}`,
          }}
        />
      </head>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
