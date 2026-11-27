import { Reveal } from '@/components/motion';
import Link from 'next/link';
import {
  ArrowRight,
  ArrowDown,
  CalendarClock,
  Check,
  FileSpreadsheet,
  Globe2,
  Layers3,
  ListChecks,
  LockKeyhole,
  ShieldCheck,
  Wallet,
} from 'lucide-react';
import { PublicFrame } from '@/components/public-frame';
import { publicMetadata } from '@/lib/public-metadata';
export const metadata = publicMetadata(
  'Features',
  'Organize domains, marketplace listings, renewals and sales in Assame workspaces.',
  '/features',
);
export default function FeaturesPage() {
  return (
    <PublicFrame>
      <main className="features-refined">
        <Reveal>
          <section className="public-heading">
            <span className="marketing-kicker">BUILT AROUND THE WORK YOU DO</span>
            <h1>
              Every detail.
              <br />A clearer direction.
            </h1>
            <p>
              From the first import to the next renewal, keep the details together and work from a
              portfolio you understand.
            </p>
          </section>
        </Reveal>
        <Reveal>
          <section className="feature-map" aria-label="Explore portfolio tools">
            <div>
              <Layers3 size={23} aria-hidden="true" />
              <span>ONE CONNECTED WORKSPACE</span>
              <strong>Your portfolio, with the context intact.</strong>
            </div>
            <nav aria-label="Feature sections">
              <a href="#feature-organize">
                Organize <ArrowDown size={14} aria-hidden="true" />
              </a>
              <a href="#feature-attention">
                Keep track <ArrowDown size={14} aria-hidden="true" />
              </a>
              <a href="#feature-finance">
                Understand <ArrowDown size={14} aria-hidden="true" />
              </a>
              <a href="#feature-control">
                Stay in control <ArrowDown size={14} aria-hidden="true" />
              </a>
            </nav>
          </section>
        </Reveal>
        <div className="feature-product-grid">
          <Reveal className="feature-span-wide">
            <section
              className="feature-product-panel feature-inventory-panel"
              id="feature-organize"
            >
              <div className="feature-panel-copy">
                <span className="marketing-kicker">01 / ORGANIZE</span>
                <Globe2 className="feature-panel-icon" size={27} aria-hidden="true" />
                <h2>
                  One portfolio,
                  <br />
                  many sources.
                </h2>
                <p>
                  Bring domain records together with manual entry, CSV imports and supported
                  provider connections. Workspaces keep separate portfolios and their data apart.
                </p>
                <Link
                  className="text-link"
                  href="/blog/organize-domain-portfolios-across-workspaces"
                >
                  Build a more organized portfolio <ArrowRight size={15} aria-hidden="true" />
                </Link>
              </div>
              <div
                className="feature-inventory-visual"
                aria-label="Illustration of inventory organization"
              >
                <div className="feature-source-tags">
                  <span>
                    <Globe2 size={13} aria-hidden="true" /> Manual entry
                  </span>
                  <span>
                    <FileSpreadsheet size={13} aria-hidden="true" /> CSV import
                  </span>
                  <span>
                    <Layers3 size={13} aria-hidden="true" /> Supported providers
                  </span>
                </div>
                <div className="feature-visual-label">YOUR WORKSPACE / INVENTORY</div>
                {[
                  ['example.studio', 'Brandable'],
                  ['example.design', 'New project'],
                  ['example.digital', 'Technology'],
                ].map(([domain, tag]) => (
                  <div className="feature-domain-record" key={domain}>
                    <Globe2 size={16} aria-hidden="true" />
                    <strong>{domain}</strong>
                    <span>{tag}</span>
                  </div>
                ))}
                <p className="feature-visual-caption">
                  Illustrative records · your structure, your context.
                </p>
              </div>
            </section>
          </Reveal>
          <Reveal>
            <section
              className="feature-product-panel feature-attention-panel"
              id="feature-attention"
            >
              <span className="marketing-kicker">02 / KEEP TRACK</span>
              <CalendarClock className="feature-panel-icon" size={27} aria-hidden="true" />
              <h2>
                The next action,
                <br />
                in plain sight.
              </h2>
              <p>
                Review registrar records, expiration dates, marketplace listings and internal asking
                prices without switching between every provider dashboard.
              </p>
              <div className="feature-attention-visual">
                <div>
                  <CalendarClock size={18} aria-hidden="true" />
                  <span>
                    Upcoming renewals<small>See expiration dates and renewal costs</small>
                  </span>
                  <ArrowRight size={15} aria-hidden="true" />
                </div>
                <div>
                  <ListChecks size={18} aria-hidden="true" />
                  <span>
                    Marketplace listings
                    <small>Keep listing details and asking prices in view</small>
                  </span>
                  <ArrowRight size={15} aria-hidden="true" />
                </div>
              </div>
            </section>
          </Reveal>
          <Reveal>
            <section className="feature-product-panel feature-finance-panel" id="feature-finance">
              <span className="marketing-kicker">03 / UNDERSTAND</span>
              <Wallet className="feature-panel-icon" size={27} aria-hidden="true" />
              <h2>
                Follow the
                <br />
                financial story.
              </h2>
              <p>
                Record acquisition costs, sales, installments, payouts and expenses, with a
                distinction between agreements and money received.
              </p>
              <div className="feature-finance-flow">
                <div>
                  <span>AGREEMENT</span>
                  <strong>A sale is agreed</strong>
                  <small>The terms you record</small>
                </div>
                <ArrowRight size={18} aria-hidden="true" />
                <div>
                  <span>CASH RECEIVED</span>
                  <strong>A payment arrives</strong>
                  <small>The money you collect</small>
                </div>
              </div>
              <p className="feature-finance-note">
                <Check size={14} aria-hidden="true" /> Agreements and received cash stay distinct.
              </p>
            </section>
          </Reveal>
          <Reveal className="feature-span-wide">
            <section className="feature-product-panel feature-control-panel" id="feature-control">
              <div className="feature-panel-copy">
                <span className="marketing-kicker">04 / STAY IN CONTROL</span>
                <ShieldCheck className="feature-panel-icon" size={27} aria-hidden="true" />
                <h2>
                  Connected.
                  <br />
                  With care.
                </h2>
                <p>
                  Provider capabilities differ. Credentials are encrypted, and supported remote
                  changes require explicit confirmation and enabled permissions.
                </p>
                <Link className="text-link" href="/integrations">
                  Explore integrations and permissions <ArrowRight size={15} aria-hidden="true" />
                </Link>
              </div>
              <div className="feature-control-visual">
                <div>
                  <LockKeyhole size={24} aria-hidden="true" />
                  <strong>Your credentials, encrypted.</strong>
                  <span>Connections belong to the workspace they serve.</span>
                </div>
                <ol>
                  <li>
                    <span>01</span>Review the supported action
                  </li>
                  <li>
                    <span>02</span>Check the change preview
                  </li>
                  <li>
                    <span>03</span>Confirm before it runs
                  </li>
                </ol>
              </div>
            </section>
          </Reveal>
        </div>
        <Reveal>
          <section className="feature-workspace-story">
            <div>
              <span className="marketing-kicker">ROOM FOR EVERY PORTFOLIO</span>
              <h2>
                Separate the work.
                <br />
                Keep the bigger picture.
              </h2>
              <p>Keep inventory, connections and financial records in their own workspace.</p>
            </div>
            <div className="feature-workspace-visual">
              <div>
                <Layers3 size={20} aria-hidden="true" />
                <strong>Your account</strong>
                <span>One sign-in</span>
              </div>
              <div className="feature-workspace-branches">
                <span>
                  Personal portfolio<small>Its own inventory and connections</small>
                </span>
                <span>
                  New project<small>Its own records and context</small>
                </span>
              </div>
            </div>
          </section>
        </Reveal>
        <Reveal>
          <section className="marketing-end">
            <span className="marketing-kicker">YOUR NEXT STEP</span>
            <h2>Bring your portfolio into focus.</h2>
            <p>
              Start with the domains you manage today. Compare the capacity and features that fit
              your work.
            </p>
            <div className="feature-end-actions">
              <Link className="marketing-button" href="/register">
                Create an account <ArrowRight size={16} aria-hidden="true" />
              </Link>
              <Link className="marketing-outline" href="/register">
                Create a Free account
              </Link>
            </div>
          </section>
        </Reveal>
      </main>
    </PublicFrame>
  );
}
