import { getRules, getSession } from '@/lib/data';
import { RulesEditor } from './RulesEditor';

export const metadata = { title: 'Règles de diffusion' };

export default async function Regles() {
  const { org } = await getSession();
  if (!org) return null;
  const rules = await getRules(org.id);

  return (
    <>
      <div className="page-head">
        <div>
          <div className="eyebrow">{org.name} · appliqué par chaque lecteur</div>
          <h1>Règles de diffusion</h1>
          <p className="lead">Ce qui se passe quand plusieurs spots tombent en même temps. Réglé une fois ici, appliqué dans chaque boutique, même hors connexion.</p>
        </div>
      </div>
      <RulesEditor orgId={org.id} initial={rules} />
    </>
  );
}
