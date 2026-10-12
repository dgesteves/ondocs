import { ImageResponse } from 'next/og';

import { Brand, COLORS, OG_SIZE, Spark, ogFonts } from '../lib/og';

export const alt =
  'ondocs: make your docs answerable by people and by agents. Beside the headline, the dialog answers “How do I add it to Docusaurus?” with the plugin config and a citation.';
export const size = OG_SIZE;
export const contentType = 'image/png';

const CODE = [
  ['// docusaurus.config.ts', COLORS.subtle],
  ['export default {', COLORS.soft],
  ["  plugins: ['ondocs/docusaurus'],", COLORS.soft],
  ['};', COLORS.soft],
] as const;

/** The site's card: what it is, and the dialog answering a real question from these docs. */
export default async function Image() {
  return new ImageResponse(
    <div
      style={{
        display: 'flex',
        width: '100%',
        height: '100%',
        padding: '64px 0 64px 72px',
        fontFamily: 'Geist',
        color: COLORS.fg,
        background: `radial-gradient(900px 520px at 85% 0%, rgba(34, 211, 238, 0.16), rgba(13, 15, 18, 0) 70%), ${COLORS.ink}`,
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', width: 590, flex: 'none' }}>
        <Brand />
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            marginTop: 56,
            fontSize: 60,
            fontWeight: 600,
            lineHeight: 1.05,
            letterSpacing: '-0.04em',
          }}
        >
          <span>Docs answerable by</span>
          <span>people and agents.</span>
        </div>
        <div
          style={{
            display: 'flex',
            marginTop: 28,
            fontSize: 25,
            lineHeight: 1.45,
            color: COLORS.muted,
          }}
        >
          One static index: a cited Ask box, an MCP server and llms.txt. Your own function and key,
          no vector database.
        </div>
        <div
          style={{
            display: 'flex',
            marginTop: 'auto',
            gap: 22,
            fontFamily: 'Geist Mono',
            fontSize: 19,
            color: COLORS.subtle,
          }}
        >
          <span>Docusaurus</span>
          <span>Starlight</span>
          <span>VitePress</span>
          <span>Next.js</span>
          <span>any site</span>
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          marginLeft: 40,
          width: 498,
          flex: 'none',
          background: COLORS.raised,
          border: `1.5px solid ${COLORS.borderStrong}`,
          borderRight: 'none',
          borderRadius: '18px 0 0 18px',
          boxShadow: '0 30px 80px rgba(0, 0, 0, 0.6)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            padding: '22px 28px',
            fontSize: 22,
            color: COLORS.fg,
            borderBottom: `1.5px solid ${COLORS.border}`,
          }}
        >
          <Spark size={22} />
          How do I add it to Docusaurus?
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', padding: '24px 28px' }}>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              fontSize: 20,
              lineHeight: 1.5,
              color: COLORS.soft,
            }}
          >
            <span>To add ondocs to Docusaurus, put the</span>
            <span>plugin in the plugins array of</span>
            <span style={{ display: 'flex', alignItems: 'center' }}>
              docusaurus.config.ts:
              <span
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: 26,
                  height: 26,
                  marginLeft: 8,
                  fontFamily: 'Geist Mono',
                  fontSize: 15,
                  color: COLORS.cyan,
                  background: 'rgba(34, 211, 238, 0.1)',
                  border: '1.5px solid rgba(34, 211, 238, 0.4)',
                  borderRadius: 6,
                }}
              >
                2
              </span>
            </span>
          </div>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              marginTop: 18,
              padding: '18px 20px',
              fontFamily: 'Geist Mono',
              fontSize: 17,
              lineHeight: 1.6,
              background: COLORS.ink,
              border: `1.5px solid ${COLORS.border}`,
              borderRadius: 10,
            }}
          >
            {CODE.map(([line, color]) => (
              <span key={line} style={{ color, whiteSpace: 'pre' }}>
                {line}
              </span>
            ))}
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 14,
              marginTop: 20,
              padding: '14px 16px',
              fontSize: 16,
              border: `1.5px solid ${COLORS.border}`,
              borderRadius: 10,
            }}
          >
            <span
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 26,
                height: 26,
                fontFamily: 'Geist Mono',
                fontSize: 15,
                color: COLORS.cyan,
                background: 'rgba(34, 211, 238, 0.1)',
                border: '1.5px solid rgba(34, 211, 238, 0.4)',
                borderRadius: 6,
              }}
            >
              2
            </span>
            <span style={{ color: COLORS.fg }}>Docusaurus</span>
            <span style={{ color: COLORS.muted }}>› Add it to docusaurus.config.ts</span>
          </div>
        </div>
      </div>
    </div>,
    { ...size, fonts: await ogFonts() },
  );
}
