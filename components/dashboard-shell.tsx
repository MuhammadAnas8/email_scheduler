"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOutAction } from "@/app/login/actions";

const destinations = [
  { href: "/", label: "Overview", icon: "▦" },
  { href: "/new-batch", label: "New Batch", icon: "＋" },
  { href: "/history", label: "History", icon: "↶" },
  { href: "/settings", label: "Settings", icon: "⚙" },
];

export function DashboardShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  if (pathname === "/login") return <main className="auth-content">{children}</main>;

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Link className="brand" href="/" aria-label="Correspond home">
          <span className="brand-mark" aria-hidden="true">✉</span>
          <span className="brand-name">correspond<span>.</span></span>
        </Link>
        <p className="workspace-label">WORKSPACE</p>
        <nav className="nav-list" aria-label="Main navigation">
          {destinations.map(({ href, label, icon }) => {
            const current = pathname === href;
            return (
              <Link
                key={href}
                className={`nav-item${current ? " active" : ""}`}
                href={href}
                aria-current={current ? "page" : undefined}
              >
                <span className="nav-icon" aria-hidden="true">{icon}</span>
                {label}
              </Link>
            );
          })}
        </nav>
        <form className="sidebar-signout" action={signOutAction}><button type="submit">Sign out</button></form>
        <p className="sidebar-note">Phase 4 · Queue controls</p>
      </aside>
      <div className="main-column">
        <header className="topbar">
          <span className="breadcrumb">Workspace <span aria-hidden="true">/</span> {destinations.find((item) => item.href === pathname)?.label ?? "Workspace"}</span>
          <span className="setup-pill"><i aria-hidden="true" /> Queue only · no sending</span>
        </header>
        <main className="content">{children}</main>
      </div>
    </div>
  );
}
