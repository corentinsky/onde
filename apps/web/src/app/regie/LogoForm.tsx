'use client';

import { useState } from 'react';
import { saveLogo } from './actions';

/**
 * Logo de l’enseigne : recadré sur son contenu, fond blanc rendu transparent, réduit à 600 px au plus,
 * puis enregistré en PNG. Affiché dans la régie et sur les lecteurs des boutiques.
 */
async function prepare(file: File): Promise<string> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('Image illisible'));
      i.src = url;
    });
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    const src = document.createElement('canvas');
    src.width = w;
    src.height = h;
    const sctx = src.getContext('2d', { willReadFrequently: true })!;
    sctx.drawImage(img, 0, 0);
    const data = sctx.getImageData(0, 0, w, h);
    const px = data.data;
    // Fond blanc (ou presque) rendu transparent ; repérage du contenu.
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const k = (y * w + x) * 4;
        const light = Math.min(px[k], px[k + 1], px[k + 2]);
        if (light >= 245) px[k + 3] = 0;
        else if (light > 200 && px[k] > 200 && px[k + 1] > 200 && px[k + 2] > 200) px[k + 3] = Math.round((px[k + 3] * (255 - light)) / 55);
        if (px[k + 3] > 16) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
    }
    sctx.putImageData(data, 0, 0);
    if (x1 < 0) throw new Error('Image vide');
    const margin = Math.round(Math.max(x1 - x0, y1 - y0) * 0.04);
    x0 = Math.max(0, x0 - margin);
    y0 = Math.max(0, y0 - margin);
    x1 = Math.min(w - 1, x1 + margin);
    y1 = Math.min(h - 1, y1 + margin);
    const cw = x1 - x0 + 1;
    const ch = y1 - y0 + 1;
    const scale = Math.min(1, 600 / Math.max(cw, ch));
    const out = document.createElement('canvas');
    out.width = Math.max(1, Math.round(cw * scale));
    out.height = Math.max(1, Math.round(ch * scale));
    out.getContext('2d')!.drawImage(src, x0, y0, cw, ch, 0, 0, out.width, out.height);
    const png = out.toDataURL('image/png');
    if (png.length > 300_000) throw new Error('Logo trop lourd, même réduit : essayez un fichier plus simple');
    return png;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function LogoForm({ orgId, orgName, logo }: { orgId: string; orgName: string; logo: string | null }) {
  const [value, setValue] = useState<string | null>(logo);
  const [error, setError] = useState<string | null>(null);
  const changed = value !== logo;

  return (
    <form action={saveLogo} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <input type="hidden" name="org_id" value={orgId} />
      <input type="hidden" name="logo" value={value ?? ''} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <div className="logo-preview">
          {value ? <img src={value} alt={`Logo ${orgName}`} /> : <span className="small muted">Aucun logo</span>}
        </div>
        <label className="btn btn-secondary btn-small" style={{ cursor: 'pointer' }}>
          Choisir une image
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/svg+xml"
            hidden
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (!f) return;
              setError(null);
              try {
                setValue(await prepare(f));
              } catch (err) {
                setError(err instanceof Error ? err.message : 'Image illisible');
              }
            }}
          />
        </label>
        {value && (
          <button className="btn btn-secondary btn-small" type="button" onClick={() => setValue(null)}>
            Retirer
          </button>
        )}
      </div>
      {error && <p className="small" style={{ color: 'var(--danger)', margin: 0 }}>{error}</p>}
      {changed && (
        <div className="actions">
          <button className="btn btn-primary" type="submit">Enregistrer le logo</button>
        </div>
      )}
    </form>
  );
}
