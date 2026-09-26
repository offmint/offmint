"use client";
import { useEffect, useState } from "react";
import { sessionNow } from "@/components/landing/StatBand";

/**
 * Weekend window status with a live countdown: "Minting off now · reopens in …" during the weekend window
 * (Sat 00:00 -> Mon 00:00 UTC), "Minting turns off in …" otherwise. It used to count to the next Saturday even while
 * the window was open (showed "opens in 6d" on a Saturday).
 */
export function Countdown() {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  if (now === null) return <><div className="label">Weekend window</div><span className="num">--</span></>;
  const { off, next } = sessionNow(now);
  const s = Math.max(0, Math.floor((next - now) / 1000));
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return (
    <>
      <div className="label">{off ? "Minting off now · reopens in" : "Minting turns off (weekend window) in"}</div>
      <span className="num">{d}d {String(h).padStart(2, "0")}h {String(m).padStart(2, "0")}m {String(sec).padStart(2, "0")}s</span>
    </>
  );
}
