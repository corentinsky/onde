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
  old: 'âgée',
  french: 'accent français',
  american: 'accent américain',
  british: 'accent britannique'
};
const t = (s?: string) => (s ? (fr[s.toLowerCase()] ?? s) : '');

export async function listVoices(): Promise<Voice[]> {
  if (!voiceConfigured) return [];
  try {
    const res = await fetch(`${API}/voices`, { headers: { 'xi-api-key': KEY }, next: { revalidate: 3600 } });
    if (!res.ok) return [];
    const body = (await res.json()) as { voices?: { voice_id: string; name: string; labels?: Record<string, string>; preview_url?: string }[] };
    return (body.voices ?? [])
      .map((v) => ({
        id: v.voice_id,
        name: v.name.split(/\s[-–]\s/)[0],
        description: [t(v.labels?.gender), t(v.labels?.age), t(v.labels?.accent)].filter(Boolean).join(', '),
        preview: v.preview_url ?? null
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  } catch {
    return [];
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
    if (res.status === 401) throw new Error('Clé ElevenLabs refusée');
    if (res.status === 429 || /quota/i.test(detail)) throw new Error('Quota ElevenLabs atteint pour ce mois');
    throw new Error(`ElevenLabs a répondu ${res.status}`);
  }
  return res.arrayBuffer();
}
