import { readFile } from 'node:fs/promises';
import path from 'node:path';

/** Geist, for `next/og`, which reads TrueType and not WOFF2. */
export async function ogFonts() {
  const dir = path.join(process.cwd(), 'node_modules/geist/dist/fonts');
  const [regular, semibold, mono] = await Promise.all([
    readFile(path.join(dir, 'geist-sans/Geist-Regular.ttf')),
    readFile(path.join(dir, 'geist-sans/Geist-SemiBold.ttf')),
    readFile(path.join(dir, 'geist-mono/GeistMono-Regular.ttf')),
  ]);
  return [
    { name: 'Geist', data: regular, weight: 400 as const, style: 'normal' as const },
    { name: 'Geist', data: semibold, weight: 600 as const, style: 'normal' as const },
    { name: 'Geist Mono', data: mono, weight: 400 as const, style: 'normal' as const },
  ];
}

export const OG_SIZE = { width: 1200, height: 630 };

export const COLORS = {
  ink: '#0d0f12',
  raised: '#14181d',
  border: '#262b33',
  borderStrong: '#353c47',
  fg: '#f5f7fa',
  soft: '#dfe6ee',
  muted: '#9aa6b4',
  subtle: '#7c8796',
  cyan: '#22d3ee',
  cyanBright: '#67e8f9',
  magenta: '#f0468a',
};

export function Spark({ size, color = COLORS.cyan }: { size: number; color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24">
      <path
        d="M12 2.5c.6 4.9 3.6 7.9 8.5 8.5-4.9.6-7.9 3.6-8.5 8.5-.6-4.9-3.6-7.9-8.5-8.5 4.9-.6 7.9-3.6 8.5-8.5Z"
        fill={color}
      />
    </svg>
  );
}

/** The brand row: the mark and the name. */
export function Brand({ suffix }: { suffix?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 48,
          height: 48,
          borderRadius: 12,
          background: 'rgba(34, 211, 238, 0.08)',
          border: '1.5px solid rgba(34, 211, 238, 0.35)',
        }}
      >
        <Spark size={26} />
      </div>
      <div style={{ display: 'flex', fontSize: 30, fontWeight: 600, color: COLORS.fg }}>
        ondocs
        {suffix ? (
          <span style={{ marginLeft: 14, color: COLORS.subtle, fontWeight: 400 }}>{suffix}</span>
        ) : null}
      </div>
    </div>
  );
}

/** A docs card: the section, title and description, and the page's address. */
export function DocCard({
  section,
  title,
  description,
  path,
}: {
  section: string;
  title: string;
  description: string;
  path: string;
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        padding: '64px 72px',
        fontFamily: 'Geist',
        color: COLORS.fg,
        background: `radial-gradient(900px 520px at 90% 0%, rgba(34, 211, 238, 0.14), rgba(13, 15, 18, 0) 70%), ${COLORS.ink}`,
      }}
    >
      <Brand suffix="docs" />
      <div
        style={{
          display: 'flex',
          marginTop: 72,
          fontFamily: 'Geist Mono',
          fontSize: 22,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          color: COLORS.cyan,
        }}
      >
        {section}
      </div>
      <div
        style={{
          display: 'flex',
          marginTop: 18,
          fontSize: 76,
          fontWeight: 600,
          lineHeight: 1.05,
          letterSpacing: '-0.035em',
        }}
      >
        {title}
      </div>
      <div
        style={{
          display: 'flex',
          maxWidth: 940,
          marginTop: 24,
          fontSize: 30,
          lineHeight: 1.4,
          color: COLORS.muted,
        }}
      >
        {description}
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginTop: 'auto',
          fontFamily: 'Geist Mono',
          fontSize: 20,
          color: COLORS.subtle,
        }}
      >
        <span>ondocs.vercel.app{path}</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 10, color: COLORS.soft }}>
          <Spark size={20} />
          Ask these docs
        </span>
      </div>
    </div>
  );
}
