import Link from 'next/link';

export const metadata = { title: 'Page introuvable' };

export default function NotFound() {
  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24, background: 'var(--bg)' }}>
      <div className="card" style={{ maxWidth: 440, textAlign: 'center' }}>
        <h1 style={{ fontSize: 28, margin: '0 0 8px' }}>Page introuvable</h1>
        <p className="sub">Cette page n’existe pas ou a été déplacée.</p>
        <Link className="btn btn-primary" href="/regie" style={{ marginTop: 16, display: 'inline-flex' }}>Retour à la régie</Link>
      </div>
    </main>
  );
}
