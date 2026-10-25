import type { AvatarDocument } from '@vexstudio/format';
import type { LoadedAsset } from '@vexstudio/runtime';
import { useEffect, useRef, useState } from 'react';
import { fetchAsset } from '../api.ts';

/** Downloads the files the document uses (once each) and keeps them ready for the player. */
export function useAssets(doc: AvatarDocument | null): { assets: Map<string, LoadedAsset>; version: number } {
  const cache = useRef(new Map<string, LoadedAsset>());
  const loading = useRef(new Set<string>());
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!doc) return;
    for (const source of doc.sources) {
      const hash = source.asset;
      if (cache.current.has(hash) || loading.current.has(hash)) continue;
      loading.current.add(hash);
      void (async () => {
        try {
          const res = await fetchAsset(hash);
          const type = res.headers.get('content-type') ?? '';
          if (type.startsWith('image/svg+xml')) cache.current.set(hash, { type: 'image/svg+xml', text: await res.text() });
          else cache.current.set(hash, { type: 'image/png', url: URL.createObjectURL(await res.blob()) });
          setVersion((v) => v + 1);
        } finally {
          loading.current.delete(hash);
        }
      })();
    }
  }, [doc]);

  useEffect(() => () => {
    for (const a of cache.current.values()) if (a.type === 'image/png') URL.revokeObjectURL(a.url);
  }, []);

  return { assets: cache.current, version };
}

/** Puts an uploaded file in the cache right away (the import already has its text). */
export function primeAsset(assets: Map<string, LoadedAsset>, hash: string, asset: LoadedAsset): void {
  assets.set(hash, asset);
}
