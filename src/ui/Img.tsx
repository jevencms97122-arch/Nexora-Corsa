import { ImageOff } from "lucide-react";
import { useEffect, useRef, useState } from "react";

interface Props {
  /** Candidats essayés dans l'ordre : le premier qui se charge est affiché. */
  srcs: string[];
  alt?: string;
  contain?: boolean;
  className?: string;
  /** Pas d'icône de repli (ex. tracé de circuit facultatif). */
  quietFallback?: boolean;
}

/** Image chargée paresseusement, avec squelette pendant le chargement et fondu à l'apparition. */
export default function Img({ srcs, alt = "", contain, className = "", quietFallback }: Props) {
  const key = srcs.join("|");
  const [index, setIndex] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    setIndex(0);
    setLoaded(false);
  }, [key]);

  // Une image déjà en cache peut être prête avant que React n'écoute « load » : on vérifie à la main.
  useEffect(() => {
    const img = imgRef.current;
    if (img?.complete && img.naturalWidth > 0) setLoaded(true);
  }, [key, index]);

  const failed = index >= srcs.length;
  return (
    <div className={`img-box ${!loaded && !failed ? "loading" : ""} ${className}`}>
      {!failed && (
        <img
          ref={imgRef}
          key={srcs[index]}
          src={srcs[index]}
          alt={alt}
          loading="lazy"
          decoding="async"
          draggable={false}
          className={`${contain ? "contain" : ""} ${loaded ? "loaded" : ""}`}
          onLoad={() => setLoaded(true)}
          onError={() => setIndex((i) => i + 1)}
        />
      )}
      {failed && !quietFallback && (
        <div className="img-fallback">
          <ImageOff size={22} />
        </div>
      )}
    </div>
  );
}
