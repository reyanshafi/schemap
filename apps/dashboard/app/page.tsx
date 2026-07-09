"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { api, type Me } from "./lib/api";

export default function Home() {
  const router = useRouter();
  useEffect(() => {
    api<Me>("/auth/me")
      .then(() => router.replace("/schemas"))
      .catch(() => router.replace("/login"));
  }, [router]);
  return <p style={{ textAlign: "center", marginTop: "20vh" }}>Loading…</p>;
}
