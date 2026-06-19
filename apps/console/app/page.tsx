import { redirect } from "next/navigation";

// Entry point — send operators straight to the dashboard. The (app) layout
// guard bounces unauthenticated users to /login.
export default function RootPage() {
  redirect("/dashboard");
}
