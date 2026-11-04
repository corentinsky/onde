import 'server-only';

/** Voix de synthèse (ElevenLabs). La clé ne quitte jamais le serveur. */
const KEY = process.env.ELEVENLABS_API_KEY ?? '';
const API = 'https://api.elevenlabs.io/v1';
export const voiceConfigured = KEY.length > 0;

export interface Voice {
  id: string;
  name: string;
  description: string;
  preview: string | null;
}

const fr: Record<string, string> = {
  female: 'femme',
  male: 'homme',
  neutral: 'neutre',
  young: 'jeune',
  'middle aged': 'âge moyen',
  'middle-aged': 'âge moyen',
  middle_aged: 'âge moyen',
  old: 'senior',
  french: 'accent français',
  american: 'accent américain',
  british: 'accent britannique',
  australian: 'accent australien',
  irish: 'accent irlandais',
  canadian: 'accent canadien',
  standard: 'accent standard'
};
const t = (s?: string) => (s ? (/^fr([-_]|$)|french|parisian/i.test(s) ? 'accent français' : (fr[s.toLowerCase()] ?? s)) : '');
const isFrench = (v: Voice) => v.description.includes('accent français');

/** Voix disponibles sur le compte, ou la raison pour laquelle on ne peut pas les lire. */
export async function listVoices(): Promise<{ voices: Voice[]; error: string | null }> {
  if (!voiceConfigured) return { voices: [], error: null };
  try {
    // Pas de cache : une réponse d’erreur ne doit pas rester en mémoire une heure.
    const res = await fetch(`${API}/voices`, { headers: { 'xi-api-key': KEY }, cache: 'no-store' });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      if (/missing_permissions|voices_read/i.test(detail)) return { voices: [], error: 'La clé ElevenLabs n’a pas le droit de lire les voix : activez « Voices » (lecture) sur la clé.' };
      if (res.status === 401) return { voices: [], error: 'Clé ElevenLabs refusée : vérifiez qu’elle est complète et active.' };
      return { voices: [], error: `ElevenLabs a répondu ${res.status}.` };
    }
    const body = (await res.json()) as {
      voices?: { voice_id: string; name: string; category?: string; labels?: Record<string, string>; preview_url?: string; fine_tuning?: { state?: Record<string, string> } }[];
    };
    const voices = (body.voices ?? [])
      // Voix « professionnelle » dont l’entraînement n’est pas terminé : ElevenLabs la refuse.
      .filter((v) => !(v.category === 'professional' && v.fine_tuning?.state && !Object.values(v.fine_tuning.state).includes('fine_tuned')))
      .map((v) => ({
        id: v.voice_id,
        name: v.name.split(/\s[-–]\s/)[0],
        description: [t(v.labels?.gender), t(v.labels?.age), t(v.labels?.accent)].filter(Boolean).join(', '),
        preview: v.preview_url ?? null
      }))
      // Voix françaises d’abord : ce sont elles qu’on choisit pour des spots en France.
      .sort((a, b) => Number(isFrench(b)) - Number(isFrench(a)) || a.name.localeCompare(b.name, 'fr'));
    return { voices, error: voices.length ? null : 'Aucune voix sur ce compte ElevenLabs.' };
  } catch {
    return { voices: [], error: 'ElevenLabs injoignable pour l’instant.' };
  }
}

/** Texte → voix (MP3 44,1 kHz). Modèle multilingue : le français est reconnu dans le texte. */
export async function synthesize(text: string, voiceId: string): Promise<ArrayBuffer> {
  const res = await fetch(`${API}/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'xi-api-key': KEY, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify({
      text,
      model_id: 'eleven_multilingual_v2',
      voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0.2, use_speaker_boost: true }
    }),
    cache: 'no-store'
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    let status = '';
    let message = '';
    try {
      const d = (JSON.parse(detail) as { detail?: { status?: string; message?: string } | string }).detail;
      status = typeof d === 'object' ? (d?.status ?? '') : '';
      message = typeof d === 'object' ? (d?.message ?? '') : String(d ?? '');
    } catch {
      message = detail.slice(0, 200);
    }
    if (/missing_permissions/i.test(status + message)) throw new Error('La clé ElevenLabs n’a pas le droit « Text to Speech » : activez-le sur la clé.');
    if (/paid_plan_required|library|subscription|upgrade/i.test(status + message))
      throw new Error('Cette voix de la bibliothèque ElevenLabs n’est utilisable par l’API qu’avec un abonnement payant (Starter). Choisissez une voix de base, ou passez à l’offre Starter.');
    if (res.status === 429 || /quota/i.test(status + message)) throw new Error('Quota ElevenLabs atteint pour ce mois.');
    if (res.status === 401) throw new Error('Clé ElevenLabs refusée.');
    throw new Error(`ElevenLabs a refusé la demande${message ? ` : ${message}` : ` (${res.status})`}`);
  }
  return res.arrayBuffer();
}
