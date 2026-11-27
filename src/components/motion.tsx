'use client';

import { domAnimation, LazyMotion, m, MotionConfig, useReducedMotion } from 'motion/react';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';

export function MotionProvider({ children }: { children: ReactNode }) {
  return (
    <MotionConfig reducedMotion="user" transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}>
      <LazyMotion features={domAnimation} strict>
        {children}
      </LazyMotion>
    </MotionConfig>
  );
}

/** Content stays visible in server HTML and with JavaScript disabled. */
export function Reveal({
  children,
  className,
  delay = 0,
  inView = true,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
  inView?: boolean;
}) {
  const reduced = useReducedMotion();
  const entrance = reduced ? { opacity: 1, y: 0 } : { opacity: [0.78, 1], y: [16, 0] };
  return (
    <m.div
      data-motion-reveal={inView ? 'scroll' : 'page'}
      className={className}
      initial={false}
      {...(inView
        ? { whileInView: entrance, viewport: { once: true, amount: 0.12 } }
        : { animate: entrance })}
      transition={{ duration: reduced ? 0 : 0.48, delay: reduced ? 0 : Math.min(delay, 0.35) }}
    >
      {children}
    </m.div>
  );
}

export function MotionPage({ children, className }: { children: ReactNode; className?: string }) {
  const pathname = usePathname();
  return (
    <Reveal key={pathname} className={className} inView={false}>
      {children}
    </Reveal>
  );
}
