'use server';

import { getSession } from '@/lib/data';
import { synthesize, voiceConfigured } from '@/lib/voice';

/** Génère la voix d’un spot. Renvoie le MP3 en base64 : le navigateur le mixe, le normalise et l’enregistre. */
export async function generateVoice(text: string, voiceId: string): Promise<{ audio?: string; error?: string }> {
  if (!voiceConfigured) return { error: 'Voix IA non configurée : ajoutez ELEVENLABS_API_KEY dans Vercel.' };
  const session = await getSession();
  if (!session.userEmail || !session.org) return { error: 'Connexion requise.' };
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (clean.length < 3) return { error: 'Écrivez le texte du spot.' };
  if (clean.length > 800) return { error: 'Texte trop long : 800 caractères au plus (environ 50 s).' };
  if (!/^[A-Za-z0-9]{8,64}$/.test(voiceId)) return { error: 'Voix inconnue.' };
  try {
    const mp3 = await synthesize(clean, voiceId);
    return { audio: Buffer.from(mp3).toString('base64') };
  } catch (e) {
    return { error: (e as Error).message };
  }
}
