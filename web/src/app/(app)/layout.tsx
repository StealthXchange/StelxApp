import { Sidebar } from "@/components/Sidebar";
import { PoolStatusBanner } from "@/components/pool/PoolStatusBanner";

export default function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="shell">
      <Sidebar />
      <div className="main-pane">
        <PoolStatusBanner />
        {children}
      </div>
    </div>
  );
}
