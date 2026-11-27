import { Reveal } from '@/components/motion';
import { PublicFrame } from '@/components/public-frame';
import { ContactForm } from '@/components/contact-form';
import { publicMetadata } from '@/lib/public-metadata';
import Link from 'next/link';
import { ArrowUpRight, Layers3, MessageCircle, ShieldCheck } from 'lucide-react';
import { contactKinds } from '@/lib/contact-kind';
export const metadata = publicMetadata(
  'Contact',
  'Contact Assame about domain portfolio management.',
  '/contact',
);
export default async function ContactPage({
  searchParams,
}: {
  searchParams: Promise<{ topic?: string }>;
}) {
  const { topic } = await searchParams;
  const kind = contactKinds.find((value) => value === topic) ?? 'contact';
  return (
    <PublicFrame>
      <main>
        <Reveal>
          <section className="contact-layout">
            <div>
              <span className="marketing-kicker">GET IN TOUCH</span>
              <h1>Let’s talk domains.</h1>
              <p>
                Have a question about Assame or a larger portfolio? Tell us what you need and send
                your request to Assame.
              </p>
              <div className="contact-topics">
                <div>
                  <span>
                    <MessageCircle size={19} />
                  </span>
                  <div>
                    <h2>Product questions</h2>
                    <p>Get clarity on features and supported connections.</p>
                  </div>
                </div>
                <div>
                  <span>
                    <Layers3 size={19} />
                  </span>
                  <div>
                    <h2>A larger portfolio</h2>
                    <p>Ask about imports, organization and performance.</p>
                  </div>
                </div>
                <div>
                  <span>
                    <ShieldCheck size={19} />
                  </span>
                  <div>
                    <h2>Account help</h2>
                    <p>Describe the issue without sharing private credentials.</p>
                  </div>
                </div>
              </div>
              <Link className="contact-faq-link" href="/faq">
                Find a quick answer in our FAQ <ArrowUpRight size={16} />
              </Link>
            </div>
            <ContactForm key={kind} initialKind={kind} />
          </section>
        </Reveal>
      </main>
    </PublicFrame>
  );
}
