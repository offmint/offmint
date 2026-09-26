import { Providers } from "./providers";
import { Nav } from "@/components/Nav";
import { Disclaimer } from "@/components/Brand";

/** The app shell: wallet connection lives here only, not on the marketing site. Edge to edge like the landing (.gutter). */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <Providers>
      <Nav />
      <main className="gutter pb-24 pt-8">{children}</main>
      <footer className="gutter pb-10"><Disclaimer /></footer>
    </Providers>
  );
}
