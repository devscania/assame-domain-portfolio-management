import { ImageResponse } from 'next/og';
import { brand } from '@/lib/brand';
export const alt = 'Assame — Every domain. One place.';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';
export default function OpenGraphImage() {
  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        background: '#111914',
        color: '#f3f7f4',
        padding: '72px 84px',
      }}
    >
      <div
        style={{ display: 'flex', alignItems: 'center', gap: 16, fontSize: 34, fontWeight: 700 }}
      >
        <div
          style={{
            width: 42,
            height: 42,
            borderRadius: 12,
            background: '#16a34a',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'white',
            fontSize: 26,
          }}
        >
          A
        </div>
        Assame
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div style={{ fontSize: 74, fontWeight: 700, letterSpacing: -4 }}>
          Every domain. One place.
        </div>
        <div style={{ fontSize: 27, color: '#a7b5aa' }}>Your domain portfolio, in perspective.</div>
      </div>
      <div style={{ display: 'flex', fontSize: 20, color: '#8ad9a2' }}>
        {new URL(brand.url).host}
      </div>
    </div>,
    size,
  );
}
