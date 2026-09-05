"use client";

import { useEffect } from "react";

export function RegisterServiceWorker() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV === "development") return;
    void navigator.serviceWorker.register("/sw.js").catch(() => {
      // Registration is best-effort; the app works without it.
    });
  }, []);
  return null;
}
