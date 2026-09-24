import Link from "next/link";
import { Logo, Disclaimer } from "@/components/Brand";

/** Marketing site shell: no wallet code, one call to action (launch the app). */
export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-mist">
      <header className="bg-matte">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
          <Logo tone="dark" height={26} />
          <nav className="flex items-center gap-6 text-sm text-[#C9D1D3]">
            <a href="#problem" className="hover:text-paper-text">Problem</a>
            <a href="#how" className="hover:text-paper-text">How it works</a>
            <a href="#proof" className="hover:text-paper-text">Proof</a>
            <a href="#risks" className="hover:text-paper-text">Risks</a>
            <Link href="/app" className="btn-glow">Launch app</Link>
          </nav>
        </div>
      </header>
      {children}
      <footer className="bg-matte">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 md:flex-row md:items-start md:justify-between">
          <Logo tone="dark" height={22} />
          <Disclaimer dark />
        </div>
      </footer>
    </div>
  );
}
