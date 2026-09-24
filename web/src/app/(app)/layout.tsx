import { Providers } from "./providers";
import { Nav } from "@/components/Nav";
import { Disclaimer } from "@/components/Brand";

/** The app shell: wallet connection lives here only, not on the marketing site. */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <Providers>
      <Nav />
      <main className="mx-auto max-w-6xl px-4 pb-24 pt-8">{children}</main>
      <footer className="mx-auto max-w-6xl px-4 pb-10"><Disclaimer /></footer>
    </Providers>
  );
}
