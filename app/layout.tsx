import type { ReactNode } from "react";
import "./styles.css";

export const metadata = { title: "Live Agent Sample App", robots: { index: false, follow: false } };
export default function Layout({ children }: { children: ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
