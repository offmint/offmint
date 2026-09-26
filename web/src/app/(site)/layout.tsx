import Link from "next/link";
import { Logo } from "@/components/Brand";
import { SiteFooter } from "@/components/landing/Footer";

/** Marketing site shell: light, no wallet code, one call to action (launch the app). */
export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-mist text-matte">
      <header className="sticky top-0 z-20 border-b border-paper-line bg-mist/90 backdrop-blur">
        <div className="gutter flex items-center justify-between py-3">
          <Logo tone="light" height={24} />
          <nav className="flex items-center gap-5 text-sm text-ink-soft">
            <a href="#evidence" className="hidden hover:text-matte sm:inline">Evidence</a>
            <a href="#how" className="hidden hover:text-matte sm:inline">How it works</a>
            <a href="#live" className="hidden hover:text-matte sm:inline">Live</a>
            <a href="#verify" className="hidden hover:text-matte md:inline">Verify</a>
            <Link href="/vault/HIMS" className="btn-primary rounded-[6px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tide">Launch app</Link>
          </nav>
        </div>
      </header>
      {children}
      <SiteFooter />
    </div>
  );
}
