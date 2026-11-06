'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { Org } from '@/lib/data';
import { selectOrg, signOut } from '@/app/regie/actions';

interface Props {
  orgs: Org[];
  orgId: string | null;
  pending: number;
  userName: string;
  role: string;
}

const groups: { title: string; items: { href: string; label: string; badge?: boolean }[] }[] = [
  {
    title: 'Antenne',
    items: [
      { href: '/regie', label: 'Vue d’ensemble' },
      { href: '/regie/spots', label: 'Spots nationaux' },
      { href: '/regie/regles', label: 'Règles de diffusion' }
    ]
  },
  {
    title: 'Musique',
    items: [
      { href: '/regie/bibliotheque', label: 'Bibliothèque' },
      { href: '/regie/ambiances', label: 'Ambiances et listes' },
      { href: '/regie/programmation', label: 'Journée type' },
      { href: '/regie/emetteur', label: 'Émetteur' }
    ]
  },
  {
    title: 'Réseau',
    items: [
      { href: '/regie/messages', label: 'Messages boutiques', badge: true },
      { href: '/regie/supervision', label: 'Supervision' }
    ]
  }
];

export function Sidebar({ orgs, orgId, pending, userName, role }: Props) {
  const path = usePathname();
  const isCurrent = (href: string) => (href === '/regie' ? path === '/regie' : path.startsWith(href));

  return (
    <nav className="sidebar" aria-label="Navigation de la régie">
      <div className="brand">
        <div className="brand-mark" aria-hidden="true">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round">
            <path d="M3 12h2M7 8v8M11 4v16M15 8v8M19 10v4" />
          </svg>
        </div>
        <div>
          <div className="brand-name">Onde</div>
          <div className="brand-sub">Régie</div>
        </div>
      </div>

      {orgs.length > 0 && (
        <form action={selectOrg} className="field">
          <span>Enseigne</span>
          <input type="hidden" name="from" value={path} />
          <select
            className="select"
            name="org"
            defaultValue={orgId ?? undefined}
            onChange={(e) => e.currentTarget.form?.requestSubmit()}
            aria-label="Choisir l’enseigne"
          >
            {orgs.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
          {orgs.find((o) => o.id === orgId)?.logo && (
            <img className="org-logo" src={orgs.find((o) => o.id === orgId)!.logo!} alt={`Logo ${orgs.find((o) => o.id === orgId)!.name}`} />
          )}
          <noscript>
            <button className="btn btn-secondary btn-small" type="submit">
              Changer
            </button>
          </noscript>
        </form>
      )}

      {groups.map((g) => (
        <div className="nav-group" key={g.title}>
          <div className="nav-title">{g.title}</div>
          {g.items.map((it) => (
            <Link key={it.href} href={it.href} className="nav-item" aria-current={isCurrent(it.href) ? 'page' : undefined}>
              <span>{it.label}</span>
              {it.badge && pending > 0 && <span className="count">{pending}</span>}
            </Link>
          ))}
        </div>
      ))}

      <div className="user-chip">
        <div className="avatar" aria-hidden="true">
          {userName.slice(0, 1).toUpperCase() || '?'}
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{userName}</div>
          <div className="small muted">{role}</div>
        </div>
        <form action={signOut}>
          <button className="btn btn-secondary btn-small" type="submit" aria-label="Se déconnecter" title="Se déconnecter">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
            </svg>
          </button>
        </form>
      </div>
    </nav>
  );
}
