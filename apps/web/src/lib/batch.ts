import 'server-only';

/** Découpe une liste (les filtres « in » passent dans l’adresse : au-delà de ~150 identifiants, elle devient trop longue). */
export function chunks<T>(list: T[], size = 150): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/** Toutes les lignes d’une requête triée, par pages (Supabase plafonne à 1 000 lignes par réponse). */
export async function allRows<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>, size = 1000): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += size) {
    const { data, error } = await page(from, from + size - 1);
    if (error) throw error;
    out.push(...(data ?? []));
    if (!data || data.length < size) return out;
  }
}

/** Même requête « in » sur plusieurs paquets d’identifiants, résultats réunis. */
export async function inChunks<T>(ids: string[], query: (ids: string[]) => PromiseLike<{ data: T[] | null; error: unknown }>, size = 150): Promise<T[]> {
  if (!ids.length) return [];
  const parts = await Promise.all(
    chunks(ids, size).map(async (c) => {
      const { data, error } = await query(c);
      if (error) throw error;
      return data ?? [];
    })
  );
  return parts.flat();
}
