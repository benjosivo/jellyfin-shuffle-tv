import { useEffect, useState } from "react";
import { imageUrl } from "../api";

/** Vignette d'un épisode, avec repli sur l'image de la série puis un fond neutre. */
export function Thumb({ itemId, seriesId, height = 300, className = "" }: { itemId: string; seriesId?: string; height?: number; className?: string }) {
  const sources = [imageUrl(itemId, height), ...(seriesId ? [imageUrl(seriesId, height)] : [])];
  const [index, setIndex] = useState(0);
  useEffect(() => setIndex(0), [itemId]);
  const src = sources[index];
  return (
    <div className={`thumb ${className}`}>
      {src && <img src={src} alt="" loading="lazy" onError={() => setIndex((i) => i + 1)} />}
    </div>
  );
}
