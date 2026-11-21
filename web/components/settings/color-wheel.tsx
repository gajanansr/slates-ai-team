'use client';
import { useEffect, useRef, useState } from 'react';
import { hexToHsv, hsvToHex } from '@/lib/custom-palette';

const MIN_V = 0.12;
const clamp = (n: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, n));

/** Pointer drag on an element: calls back with the pointer position, keeps tracking outside it. */
function useDrag(onPoint: (x: number, y: number, el: HTMLElement) => void) {
  const el = useRef<HTMLDivElement>(null);
  const live = useRef(onPoint);
  live.current = onPoint;
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (!on) return;
    const move = (e: PointerEvent) => el.current && live.current(e.clientX, e.clientY, el.current);
    const end = () => setOn(false);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
    };
  }, [on]);
  const down = (e: React.PointerEvent) => {
    e.preventDefault();
    setOn(true);
    if (el.current) live.current(e.clientX, e.clientY, el.current);
  };
  return { el, down, on };
}

/**
 * Colour wheel: angle is the hue, distance from the centre is how vivid it is, and the slider below sets
 * brightness. Pure CSS gradients and pointer events (no native colour dialog). Keeps its own hue/saturation
 * so dragging through grey or black doesn't lose your place.
 */
export function ColorWheel({ value, onChange, onDone }: { value: string; onChange: (hex: string) => void; onDone?: () => void }) {
  const [hsv, setHsv] = useState<[number, number, number]>(() => hexToHsv(value));
  // Follow outside changes (reset, saved layout) but not our own echoes.
  useEffect(() => {
    if (hsvToHex(hsv[0], hsv[1], hsv[2]) !== value.toLowerCase()) setHsv(hexToHsv(value));
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps
  const [h, s, v] = hsv;
  const set = (n: [number, number, number]) => {
    setHsv(n);
    onChange(hsvToHex(n[0], n[1], n[2]));
  };

  const wheel = useDrag((x, y, el) => {
    const r = el.getBoundingClientRect(), R = r.width / 2;
    const dx = x - (r.left + R), dy = y - (r.top + R);
    set([(Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360, clamp(Math.hypot(dx, dy) / R), v]);
  });
  const bright = useDrag((x, _y, el) => {
    const r = el.getBoundingClientRect();
    set([h, s, clamp((x - r.left) / r.width, MIN_V, 1)]);
  });

  const rad = (h * Math.PI) / 180;
  const tx = 50 + Math.sin(rad) * s * 50, ty = 50 - Math.cos(rad) * s * 50;
  const here = hsvToHex(h, s, v);

  return (
    <div className="card mt-2 flex flex-col items-center gap-5 p-5">
      <div
        ref={wheel.el}
        role="slider"
        tabIndex={0}
        aria-label="Colour: left and right change the hue, up and down change how vivid"
        aria-valuetext={here}
        aria-valuenow={Math.round(h)}
        aria-valuemin={0}
        aria-valuemax={360}
        onPointerDown={wheel.down}
        onKeyDown={(e) => {
          const k = e.key;
          if (k === 'ArrowLeft') set([(h + 350) % 360, s, v]);
          else if (k === 'ArrowRight') set([(h + 10) % 360, s, v]);
          else if (k === 'ArrowUp') set([h, clamp(s + 0.05), v]);
          else if (k === 'ArrowDown') set([h, clamp(s - 0.05), v]);
          else return;
          e.preventDefault();
        }}
        className="relative aspect-square w-full max-w-[240px] cursor-crosshair touch-none select-none rounded-full outline-none ring-1 ring-line focus-visible:ring-2 focus-visible:ring-[var(--ink)]"
        style={{ background: 'radial-gradient(circle closest-side, #fff, rgb(255 255 255 / 0) 100%), conic-gradient(from 0deg, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)' }}
      >
        <span className="pointer-events-none absolute inset-0 rounded-full bg-black" style={{ opacity: 1 - v }} aria-hidden />
        <span
          aria-hidden
          className={`pointer-events-none absolute size-7 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-white shadow-[0_2px_8px_rgb(0_0_0/0.45)] transition-transform ${wheel.on ? 'scale-110' : ''}`}
          style={{ left: `${tx}%`, top: `${ty}%`, background: here }}
        />
      </div>

      <div className="w-full max-w-[240px]">
        <p className="kicker mb-2 flex items-center justify-between">
          <span>Brightness</span>
          <span className="size-4 rounded-full ring-1 ring-line" style={{ background: here }} aria-hidden />
        </p>
        <div
          ref={bright.el}
          role="slider"
          tabIndex={0}
          aria-label="Brightness"
          aria-valuemin={Math.round(MIN_V * 100)}
          aria-valuemax={100}
          aria-valuenow={Math.round(v * 100)}
          onPointerDown={bright.down}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') set([h, s, clamp(v - 0.05, MIN_V, 1)]);
            else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') set([h, s, clamp(v + 0.05, MIN_V, 1)]);
            else return;
            e.preventDefault();
          }}
          className="relative h-8 cursor-pointer touch-none select-none rounded-full outline-none ring-1 ring-line focus-visible:ring-2 focus-visible:ring-[var(--ink)]"
          style={{ background: `linear-gradient(to right, #000, ${hsvToHex(h, s, 1)})` }}
        >
          <span
            aria-hidden
            className={`pointer-events-none absolute top-1/2 size-7 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] border-white shadow-[0_2px_8px_rgb(0_0_0/0.45)] ${bright.on ? 'scale-110' : ''}`}
            style={{ left: `${((v - 0) / 1) * 100}%`, background: here }}
          />
        </div>
      </div>
      {onDone && (
        <button type="button" onClick={onDone} className="btn btn-glass w-full max-w-[240px]">
          Done
        </button>
      )}
    </div>
  );
}
