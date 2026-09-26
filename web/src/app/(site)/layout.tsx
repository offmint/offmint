import Link from "next/link";
import { PillNav } from "@/components/PillNav";
import { SiteFooter } from "@/components/landing/Footer";

const links = [
  ["#evidence", "Evidence"],
  ["#features", "Features"],
  ["#how", "How it works"],
  ["#live", "Live"],
  ["#faq", "FAQ"],
] as const;

/** Marketing site shell: light, no wallet code, one call to action (launch the app). */
export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-mist text-matte">
      <PillNav
        links={links}
        right={<Link href="/vault/HIMS" className="btn-ghost rounded-full px-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tide">Launch app</Link>}
      />
      {children}
      <SiteFooter />
    </div>
  );
}
