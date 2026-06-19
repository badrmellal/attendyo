import { AppShell } from "@/components/AppShell";

// The authenticated section of the Console. AppShell renders the Sidebar +
// TopBar and guards access (redirects to /login without a token).
export default function AppGroupLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
