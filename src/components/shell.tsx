import Link from 'next/link';
import type { ReactNode } from 'react';
import type { AppTime } from '@/contracts';
import { date } from '@/client/format';
import { Badge } from './ui';
export function Shell({
  children,
  active = 'overview',
  appTime,
  policy
}: {
  children: ReactNode;
  active?: 'overview' | 'invoices';
  appTime?: AppTime;
  policy?: string;
}) {
  return <div className="app-shell">
    <a className="skip-link" href="#main">Skip to content</a>
    <aside className="sidebar">
      <Link href="/" className="brand" aria-label="Due home"><span className="brand-mark">
          <i />
          <i />
          <i />
        </span>due<span className="brand-period">.</span></Link>
      <p className="workspace-label">WORKSPACE</p>
      <div className="workspace">
        <span className="workspace-icon">S</span>
        <div>Studio workspace<small>Accounts receivable</small></div>
      </div>
      <nav aria-label="Main navigation">
        <Link className={active === 'overview' ? 'nav-link active' : 'nav-link'} href="/"><span>▦</span>Overview</Link>
        <Link className={active === 'invoices' ? 'nav-link active' : 'nav-link'} href="/#invoices"><span>▤</span>Invoices</Link>
        <Link className="nav-link" href="/#activity"><span>↗</span>Agent activity</Link>
        <Link className="nav-link" href="/#reviews"><span>◈</span>Needs review</Link>
        <Link className="nav-link" href="/#services"><span>⊞</span>Connections</Link>
      </nav>
      <div className="sidebar-note">
        <span className="status-dot" />
        <strong>From work to payment.</strong>
        <p>Every pound explained.<br />Every follow-up accounted for.</p>
      </div>
      <div className="sidebar-footer">
        <span className="avatar">SW</span>
        <div>Studio workspace<small>Demo environment</small></div>
      </div>
    </aside>
    <div className="workspace-main">
      <header className="topbar">
        <span className="breadcrumb">Workspace <span>/</span> {active === 'overview' ? 'Overview' : 'Invoice detail'}</span>
        <Badge tone="green">STRIPE TEST MODE</Badge>
      </header>
      <main id="main">
        <div className="environment-strip">
          <span>{appTime ? 'Connected API · Stripe test environment' : 'Awaiting API response'}</span>
          <span className={appTime?.simulated ? 'simulated-clock' : ''}>{appTime && <><b>{appTime.simulated ? 'SIMULATED TIME' : 'APP TIME'}</b> {date(appTime.now, true)} · London</>}</span>
        </div>
        {children}
        <footer className="page-footer">
          <span>Due · From completed work to collected payment.</span>
          {policy && <span>Policy {policy}</span>}
        </footer>
      </main>
    </div>
  </div>;
}
