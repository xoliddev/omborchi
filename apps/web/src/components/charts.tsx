/**
 * Small hand-built SVG charts following the dataviz rules: one y-axis, hairline recessive grid,
 * 2px lines with a 10% area wash, ≥8px end dots with a surface ring, a crosshair + tooltip, legends
 * for ≥2 series, sparing direct labels, text in ink tokens (never the series colour) and a table view.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useI18n } from '../i18n';

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [w, setW] = useState(600);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver((e) => setW(Math.max(240, e[0].contentRect.width)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w] as const;
}

function niceTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0, 1];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const ticks: number[] = [];
  for (let v = 0; v <= max + step * 0.001; v += step) ticks.push(v);
  if (ticks[ticks.length - 1] < max) ticks.push(ticks[ticks.length - 1] + step);
  return ticks;
}

export interface Series {
  key: string;
  label: string;
  color: string;
  values: number[];
  area?: boolean;
}

export function TimeChart({ days, series, height = 240, valueFormat }: { days: string[]; series: Series[]; height?: number; valueFormat?: (v: number) => string }) {
  const { fmt, t } = useI18n();
  const [ref, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const vf = valueFormat ?? fmt.money;
  const pad = { l: 52, r: 16, t: 12, b: 26 };
  const iw = width - pad.l - pad.r;
  const ih = height - pad.t - pad.b;
  const max = Math.max(1, ...series.flatMap((s) => s.values));
  const minV = Math.min(0, ...series.flatMap((s) => s.values));
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1];
  const x = (i: number) => pad.l + (days.length <= 1 ? iw / 2 : (i / (days.length - 1)) * iw);
  const y = (v: number) => pad.t + ih - ((v - Math.min(0, minV)) / (top - Math.min(0, minV))) * ih;
  const path = (vals: number[]) => vals.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const labelEvery = Math.max(1, Math.ceil(days.length / Math.max(2, Math.floor(iw / 70))));
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - r.left - pad.l;
    setHover(Math.max(0, Math.min(days.length - 1, Math.round((px / iw) * (days.length - 1)))));
  };
  const last = days.length - 1;
  return (
    <div className="stack" style={{ gap: 10 }}>
      {series.length > 1 && (
        <div className="legend">
          {series.map((s) => (
            <span key={s.key}>
              <i className="swatch line" style={{ background: s.color }} />
              {s.label}
            </span>
          ))}
        </div>
      )}
      <div className="chart" ref={ref}>
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={series.map((s) => s.label).join(', ')}
          tabIndex={0}
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowLeft') setHover((h) => Math.max(0, (h ?? last + 1) - 1));
            if (e.key === 'ArrowRight') setHover((h) => Math.min(last, (h ?? -1) + 1));
            if (e.key === 'Escape') setHover(null);
          }}
          onBlur={() => setHover(null)}
        >
          {ticks.map((tk) => (
            <g key={tk}>
              <line x1={pad.l} x2={width - pad.r} y1={y(tk)} y2={y(tk)} stroke={tk === 0 ? 'var(--axis)' : 'var(--grid)'} strokeWidth={1} />
              <text x={pad.l - 8} y={y(tk)} dy="0.32em" textAnchor="end" fontSize={11} fill="var(--muted)" className="num">
                {fmt.compact(tk)}
              </text>
            </g>
          ))}
          {days.map((d, i) =>
            i % labelEvery === 0 || i === last ? (
              <text key={d} x={x(i)} y={height - 6} textAnchor={i === 0 ? 'start' : i === last ? 'end' : 'middle'} fontSize={11} fill="var(--muted)">
                {fmt.shortDate(d)}
              </text>
            ) : null,
          )}
          {series.map((s) =>
            s.area ? <path key={`a-${s.key}`} d={`${path(s.values)}L${x(last)},${y(0)}L${x(0)},${y(0)}Z`} fill={s.color} opacity={0.1} /> : null,
          )}
          {series.map((s) => (
            <path key={s.key} d={path(s.values)} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          ))}
          {series.map((s) => (
            <circle key={`e-${s.key}`} cx={x(last)} cy={y(s.values[last] ?? 0)} r={4} fill={s.color} stroke="var(--surface)" strokeWidth={2} />
          ))}
          {hover !== null && (
            <g>
              <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={pad.t + ih} stroke="var(--line-strong)" strokeWidth={1} />
              {series.map((s) => (
                <circle key={s.key} cx={x(hover)} cy={y(s.values[hover] ?? 0)} r={4.5} fill={s.color} stroke="var(--surface)" strokeWidth={2} />
              ))}
            </g>
          )}
        </svg>
        {hover !== null && (
          <div className="tip" style={{ left: Math.min(width - 190, Math.max(0, x(hover) + 12)), top: 8 }}>
            <div className="muted" style={{ marginBottom: 4 }}>
              {fmt.date(days[hover])}
            </div>
            {series.map((s) => (
              <div className="tip-row" key={s.key}>
                <span className="row" style={{ gap: 6 }}>
                  <i className="swatch" style={{ background: s.color }} />
                  {s.label}
                </span>
                <b className="num">{vf(s.values[hover] ?? 0)}</b>
              </div>
            ))}
          </div>
        )}
      </div>
      <details className="small muted">
        <summary style={{ cursor: 'pointer' }}>{t('chart.table')}</summary>
        <div className="table-wrap" style={{ maxHeight: 240, marginTop: 8 }}>
          <table className="data">
            <thead>
              <tr>
                <th>{t('common.date')}</th>
                {series.map((s) => (
                  <th key={s.key} className="right">
                    {s.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {days.map((d, i) => (
                <tr key={d}>
                  <td>{fmt.date(d)}</td>
                  {series.map((s) => (
                    <td key={s.key} className="right">
                      {vf(s.values[i] ?? 0)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

export function BarList({ items, color = 'var(--s1)', format }: { items: { key: string; label: ReactNode; value: number; sub?: ReactNode }[]; color?: string; format?: (v: number) => string }) {
  const { fmt } = useI18n();
  const f = format ?? fmt.money;
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <div className="barlist">
      {items.map((i) => (
        <div key={i.key} className="barlist-row" title={`${typeof i.label === 'string' ? i.label : ''} — ${f(i.value)}`}>
          <span className="ellipsis">
            {i.label}
            {i.sub && <span className="muted small"> · {i.sub}</span>}
          </span>
          <b className="num small">{f(i.value)}</b>
          <div className="barlist-track">
            <div className="barlist-fill" style={{ width: `${(Math.max(0, i.value) / max) * 100}%`, background: color }} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** Tall segmented bar — one whole split into parts; labels only where they fit. */
export function SegmentedBar({ parts, format }: { parts: { key: string; label: string; value: number; color: string; ink?: string }[]; format?: (v: number) => string }) {
  const { fmt } = useI18n();
  const f = format ?? fmt.compact;
  const total = parts.reduce((s, p) => s + Math.max(0, p.value), 0);
  const [hover, setHover] = useState<string | null>(null);
  const visible = useMemo(() => parts.filter((p) => p.value > 0), [parts]);
  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="segbar" role="img" aria-label={parts.map((p) => `${p.label}: ${f(p.value)}`).join(', ')}>
        {visible.map((p) => {
          const share = total ? p.value / total : 0;
          return (
            <div
              key={p.key}
              style={{ flex: `${share} 1 0`, background: p.color, color: p.ink ?? '#fff', outline: hover === p.key ? '2px solid var(--ink)' : undefined }}
              title={`${p.label}: ${f(p.value)} (${fmt.pct(share * 100)})`}
              onPointerEnter={() => setHover(p.key)}
              onPointerLeave={() => setHover(null)}
            >
              {share > 0.12 ? fmt.pct(share * 100, 0) : ''}
            </div>
          );
        })}
      </div>
      <div className="legend">
        {parts.map((p) => (
          <span key={p.key}>
            <i className="swatch" style={{ background: p.color }} />
            {p.label}
            <b className="num" style={{ color: 'var(--ink)' }}>
              {f(p.value)}
            </b>
          </span>
        ))}
      </div>
    </div>
  );
}

export const SERIES = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)', 'var(--s5)'];
