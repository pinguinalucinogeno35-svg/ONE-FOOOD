'use client';

import type { CourierPosition } from '@onefood/shared';
import type { Map as LeafletMap, Marker } from 'leaflet';
import { useEffect, useRef } from 'react';
import 'leaflet/dist/leaflet.css';
import { IconMinus, IconPlus } from './icons';

// Em produção, aponte para um provedor de mapas contratado. O servidor público do
// OpenStreetMap serve para desenvolvimento e demonstração, não para uso comercial pesado.
const TILES_URL = process.env.NEXT_PUBLIC_MAP_TILES_URL ?? 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

/** Marcador próprio: um pino com o ponto do entregador, na cor da marca. */
const PIN = `<svg viewBox="0 0 32 40" width="32" height="40" aria-hidden="true">
  <path d="M16 38.5C16 38.5 3.5 25 3.5 15.2a12.5 12.5 0 0125 0C28.500 25 16 38.5 16 38.5z"
    fill="var(--accent)" stroke="var(--surface)" stroke-width="2"/>
  <circle cx="16" cy="15" r="4.5" fill="var(--surface)"/>
</svg>`;

/** Mapa com a última posição do entregador. A posição muda sem recriar o mapa. */
export function CourierMap({ position, label }: { position: CourierPosition; label: string }) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<LeafletMap | null>(null);
  const marker = useRef<Marker | null>(null);
  const latest = useRef(position);
  latest.current = position;

  useEffect(() => {
    let cancelled = false;
    void import('leaflet').then((leaflet) => {
      if (cancelled || !container.current || map.current) return;
      const { lat, lng } = latest.current;
      const created = leaflet
        .map(container.current, { zoomControl: false, attributionControl: true })
        .setView([lat, lng], 15);
      created.attributionControl.setPrefix(false);
      leaflet
        .tileLayer(TILES_URL, {
          maxZoom: 19,
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        })
        .addTo(created);
      marker.current = leaflet
        .marker([lat, lng], {
          icon: leaflet.divIcon({ html: PIN, className: 'courier-pin', iconSize: [32, 40], iconAnchor: [16, 38] }),
          keyboard: false,
        })
        .addTo(created);
      map.current = created;
    });
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
      marker.current = null;
    };
  }, []);

  useEffect(() => {
    marker.current?.setLatLng([position.lat, position.lng]);
    map.current?.panTo([position.lat, position.lng]);
  }, [position.lat, position.lng]);

  return (
    <div className="map-frame">
      <div
        ref={container}
        className="map"
        role="img"
        aria-label={label}
        data-lat={position.lat.toFixed(5)}
        data-lng={position.lng.toFixed(5)}
      />
      {/* Controles próprios: os do mapa usam caracteres como ícone. */}
      <div className="map-zoom">
        <button
          type="button"
          className="btn btn-icon"
          aria-label="Aproximar o mapa"
          onClick={() => map.current?.zoomIn()}
        >
          <IconPlus />
        </button>
        <button
          type="button"
          className="btn btn-icon"
          aria-label="Afastar o mapa"
          onClick={() => map.current?.zoomOut()}
        >
          <IconMinus />
        </button>
      </div>
    </div>
  );
}
