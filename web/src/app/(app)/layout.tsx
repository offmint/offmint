import { Providers } from "./providers";
import { Nav } from "@/components/Nav";
import { SiteFooter } from "@/components/landing/Footer";

/**
 * The app shell: wallet connection lives here only, not on the marketing site. Same structure as the landing:
 * pill nav, the page as a light panel inset on the dark band, then the footer card.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <Providers>
      <Nav />
      <div className="bg-matte pt-2 sm:pt-3">
        <main className="gutter mx-2 min-h-[70vh] rounded-[20px] bg-mist pb-24 pt-8 text-matte sm:mx-3">{children}</main>
      </div>
      <SiteFooter />
    </Providers>
  );
}
