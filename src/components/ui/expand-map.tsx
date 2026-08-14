"use client";

import { useMemo, useRef, useState, type MouseEvent } from "react";
import {
  AnimatePresence,
  motion,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
} from "framer-motion";

type LocationMapProps = {
  location: string;
  latitude: number | null;
  longitude: number | null;
  radiusKm: number;
  locating?: boolean;
  onRequestLocation?: () => void;
  className?: string;
};

const OSM_EMBED_URL = "https://www.openstreetmap.org/export/embed.html";
const OSM_MAP_URL = "https://www.openstreetmap.org";

function mapUrls(latitude: number, longitude: number, radiusKm: number) {
  // O viewport tem uma pequena margem além do círculo. A correção pela latitude
  // mantém a escala horizontal coerente mesmo longe da linha do Equador.
  const margin = 1.35;
  const latDelta = (radiusKm / 111.32) * margin;
  const cosLatitude = Math.max(0.2, Math.cos((latitude * Math.PI) / 180));
  const lngDelta = (radiusKm / (111.32 * cosLatitude)) * margin;
  const bbox = [
    longitude - lngDelta,
    latitude - latDelta,
    longitude + lngDelta,
    latitude + latDelta,
  ].map((value) => value.toFixed(6)).join(",");
  const zoom = radiusKm <= 5 ? 12 : radiusKm <= 10 ? 11 : radiusKm <= 25 ? 10 : radiusKm <= 50 ? 9 : radiusKm <= 100 ? 8 : 7;

  return {
    embed: `${OSM_EMBED_URL}?bbox=${encodeURIComponent(bbox)}&layer=mapnik&marker=${encodeURIComponent(`${latitude.toFixed(6)},${longitude.toFixed(6)}`)}`,
    open: `${OSM_MAP_URL}/?mlat=${latitude.toFixed(6)}&mlon=${longitude.toFixed(6)}#map=${zoom}/${latitude.toFixed(6)}/${longitude.toFixed(6)}`,
  };
}

export function LocationMap({
  location,
  latitude,
  longitude,
  radiusKm,
  locating = false,
  onRequestLocation,
  className = "",
}: LocationMapProps) {
  const [isHovered, setIsHovered] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();
  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);
  const rotateX = useTransform(mouseY, [-120, 120], [2.5, -2.5]);
  const rotateY = useTransform(mouseX, [-180, 180], [-2.5, 2.5]);
  const springRotateX = useSpring(rotateX, { stiffness: 300, damping: 30 });
  const springRotateY = useSpring(rotateY, { stiffness: 300, damping: 30 });
  const hasLocation = latitude !== null && longitude !== null;
  const urls = useMemo(
    () => hasLocation ? mapUrls(latitude, longitude, radiusKm) : null,
    [hasLocation, latitude, longitude, radiusKm],
  );

  function handleMouseMove(event: MouseEvent<HTMLDivElement>) {
    if (!containerRef.current || reducedMotion) return;
    const rect = containerRef.current.getBoundingClientRect();
    mouseX.set(event.clientX - (rect.left + rect.width / 2));
    mouseY.set(event.clientY - (rect.top + rect.height / 2));
  }

  function handleMouseLeave() {
    mouseX.set(0);
    mouseY.set(0);
    setIsHovered(false);
  }

  return (
    <motion.div
      ref={containerRef}
      className={`relative w-full select-none ${className}`}
      style={{ perspective: 1000 }}
      onMouseMove={handleMouseMove}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={handleMouseLeave}
    >
      <motion.div
        className="relative w-full overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--surface-2)] shadow-sm"
        style={{
          rotateX: reducedMotion ? 0 : springRotateX,
          rotateY: reducedMotion ? 0 : springRotateY,
          transformStyle: "preserve-3d",
        }}
        animate={{ height: isExpanded ? 380 : 236 }}
        transition={reducedMotion ? { duration: 0 } : { type: "spring", stiffness: 380, damping: 36 }}
      >
        {urls ? (
          <iframe
            key={urls.embed}
            src={urls.embed}
            title={`Mapa da área de atendimento em ${location}`}
            className="absolute inset-0 h-full w-full border-0"
            style={{ pointerEvents: isExpanded ? "auto" : "none", filter: "saturate(.82) contrast(.98)" }}
            loading="lazy"
            referrerPolicy="strict-origin-when-cross-origin"
          />
        ) : (
          <div className="absolute inset-0 bg-[linear-gradient(90deg,color-mix(in_srgb,var(--line)_55%,transparent)_1px,transparent_1px),linear-gradient(color-mix(in_srgb,var(--line)_55%,transparent)_1px,transparent_1px)] bg-[size:24px_24px]" />
        )}

        <div
          className="pointer-events-none absolute inset-0 bg-gradient-to-t from-[color-mix(in_srgb,var(--surface)_94%,transparent)] via-transparent to-[color-mix(in_srgb,var(--surface)_24%,transparent)] transition-opacity"
          style={{ opacity: isExpanded ? 0.28 : 1 }}
        />

        <AnimatePresence>
          {hasLocation && (
            <motion.div
              className="pointer-events-none absolute inset-0 grid place-items-center"
              initial={{ opacity: 0, scale: 0.7 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.7 }}
              transition={reducedMotion ? { duration: 0 } : { type: "spring", stiffness: 320, damping: 24 }}
            >
              <div
                className="grid aspect-square h-[74%] max-h-[280px] place-items-center rounded-full border-2 border-[var(--cool)] bg-[color-mix(in_srgb,var(--cool)_16%,transparent)] shadow-[0_0_0_1px_color-mix(in_srgb,var(--surface)_68%,transparent),0_12px_40px_color-mix(in_srgb,var(--cool)_18%,transparent)]"
                aria-hidden="true"
              >
                <motion.span
                  className="relative grid h-5 w-5 place-items-center rounded-full border-[3px] border-white bg-[var(--cool)] shadow-[0_3px_12px_rgba(0,0,0,.34)] after:absolute after:top-5 after:rounded-full after:bg-[var(--cool-deep)] after:px-3 after:py-1.5 after:text-xs after:font-bold after:text-white after:shadow-lg after:content-[attr(data-radius)]"
                  data-radius={`${radiusKm} km`}
                  animate={reducedMotion ? undefined : { scale: [1, 1.05, 1] }}
                  transition={{ duration: 1.8, repeat: Infinity, repeatDelay: 1.5 }}
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {!isExpanded && (
          <button
            type="button"
            className="absolute inset-0 z-10 cursor-pointer text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--cool)]"
            onClick={() => hasLocation ? setIsExpanded(true) : onRequestLocation?.()}
            aria-expanded={false}
            aria-label={hasLocation ? "Expandir mapa" : "Usar minha localização no mapa"}
            disabled={!hasLocation && (locating || !onRequestLocation)}
          >
            <span className="absolute left-4 top-4 flex items-center gap-2 rounded-full border border-[color-mix(in_srgb,var(--line)_74%,transparent)] bg-[color-mix(in_srgb,var(--surface)_90%,transparent)] px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-[var(--ink-soft)] shadow-sm backdrop-blur-sm">
              <span className={`h-2 w-2 rounded-full ${hasLocation ? "bg-[var(--good)]" : locating ? "animate-pulse bg-[var(--cool)]" : "bg-[var(--ink-faint)]"}`} />
              {hasLocation ? "Área configurada" : locating ? "Localizando..." : "Aguardando localização"}
            </span>

            <span className="absolute bottom-4 left-4 right-4 flex items-end justify-between gap-4">
              <span className="min-w-0 rounded-xl bg-[color-mix(in_srgb,var(--surface)_88%,transparent)] px-3 py-2 shadow-sm backdrop-blur-sm">
                <span className="block truncate text-sm font-bold text-[var(--ink)]">{location || "Use sua localização atual"}</span>
                <span className="mt-0.5 block text-xs text-[var(--ink-soft)]">
                  {hasLocation ? `Atendimento em até ${radiusKm} km da base` : "Clique aqui para localizar no mapa"}
                </span>
              </span>
              <motion.span
                className="shrink-0 rounded-full bg-[var(--ink)] px-3 py-2 text-[11px] font-bold text-[var(--surface)] shadow-sm"
                animate={{ y: isHovered && !reducedMotion ? -2 : 0 }}
              >
                {locating ? "Aguarde" : hasLocation ? "Expandir" : "Localizar"}
              </motion.span>
            </span>
          </button>
        )}

        {urls && isExpanded && (
          <>
            <button
              type="button"
              onClick={() => setIsExpanded(false)}
              className="absolute left-4 top-4 z-20 rounded-full border border-[var(--line)] bg-[var(--surface)] px-3 py-1.5 text-[11px] font-bold text-[var(--ink)] shadow-sm"
            >
              ← Recolher
            </button>
            <a
              href={urls.open}
              target="_blank"
              rel="noreferrer"
              className="absolute right-4 top-4 z-20 rounded-full border border-[var(--line)] bg-[var(--surface)] px-3 py-1.5 text-[11px] font-bold text-[var(--cool-deep)] shadow-sm"
            >
              Abrir no OpenStreetMap ↗
            </a>
          </>
        )}

        <a
          href="https://www.openstreetmap.org/copyright"
          target="_blank"
          rel="noreferrer"
          className="absolute bottom-1 right-2 z-20 text-[9px] font-medium text-[var(--ink-soft)] underline"
        >
          © OpenStreetMap
        </a>
      </motion.div>
    </motion.div>
  );
}
