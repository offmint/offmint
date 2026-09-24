"use client";
import { useEffect, useState } from "react";
import { nextSaturday } from "@/lib/format";

/** Countdown to the next weekend window (Sat 00:00 UTC). */
export function Countdown() {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (now === null) return <span className="num">--</span>;
  const s = Math.max(0, nextSaturday(now) - Math.floor(now / 1000));
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return <span className="num">{d}d {String(h).padStart(2, "0")}h {String(m).padStart(2, "0")}m {String(sec).padStart(2, "0")}s</span>;
}
