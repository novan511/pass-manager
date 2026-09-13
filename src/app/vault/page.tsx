import type { Metadata } from "next";
import { VaultApp } from "@/components/vault/VaultApp";

export const metadata: Metadata = { title: "Vault" };

export default function VaultPage() {
  return <VaultApp />;
}
