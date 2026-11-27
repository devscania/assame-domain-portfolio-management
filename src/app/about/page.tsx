import { Reveal } from '@/components/motion';
import Link from 'next/link';
import { ArrowRight, FolderKanban, Layers3, ListChecks, SlidersHorizontal } from 'lucide-react';
import { PublicFrame } from '@/components/public-frame';
import { publicMetadata } from '@/lib/public-metadata';

export const metadata = publicMetadata(
  'About',
  'Learn what Assame is building for people who manage domain portfolios.',
  '/about',
);

export default function AboutPage() {
  return (
    <PublicFrame>
      <main>
        <Reveal>
          <section className="public-heading">
            <span className="marketing-kicker">ABOUT ASSAME</span>
            <h1>More clarity for every domain.</h1>
            <p>
              Domain portfolios can span registrars, marketplaces and distinct business contexts.
              Assame brings the work of managing them into one place.
            </p>
          </section>
        </Reveal>
        <Reveal>
          <section className="about-story" aria-labelledby="about-story-title">
            <div className="about-story-copy">
              <span className="marketing-kicker">THE IDEA BEHIND ASSAME</span>
              <h2 id="about-story-title">
                One account.
                <br />
                Room for every portfolio.
              </h2>
              <p>
                Domain management is rarely one tidy list. Different projects, business contexts and
                provider connections need their own space.
              </p>
              <p>
                Assame builds on a multi-workspace application. Each workspace keeps its own
                inventory, connections and portfolio records.
              </p>
              <Link className="text-link" href="/features">
                Explore how Assame works <ArrowRight size={15} aria-hidden="true" />
              </Link>
            </div>
            <div
              className="about-workspace-visual"
              aria-label="Illustration of separate workspaces within one Assame account"
            >
              <div className="about-visual-account">
                <span className="about-visual-icon">
                  <Layers3 size={22} aria-hidden="true" />
                </span>
                <div>
                  <strong>Your Assame account</strong>
                  <span>One sign-in for all workspaces</span>
                </div>
              </div>
              <div className="about-visual-connector" aria-hidden="true" />
              <div className="about-workspace-examples">
                {['Main portfolio', 'New project'].map((name) => (
                  <div className="about-workspace-example" key={name}>
                    <FolderKanban size={20} aria-hidden="true" />
                    <strong>{name}</strong>
                    <span>Inventory</span>
                    <span>Connections</span>
                    <span>Portfolio records</span>
                  </div>
                ))}
              </div>
              <p>Separate workspaces. A clearer view.</p>
              <span className="about-visual-caption">Workspace structure illustration</span>
            </div>
          </section>
        </Reveal>
        <Reveal>
          <section className="about-principles" aria-labelledby="about-principles-title">
            <div className="about-section-heading">
              <span className="marketing-kicker">A PRACTICAL APPROACH</span>
              <h2 id="about-principles-title">Clarity in the details.</h2>
              <p>Useful structure, practical tools and clear expectations for the work ahead.</p>
            </div>
            <div className="about-principle-grid">
              <article>
                <span className="about-principle-icon">
                  <Layers3 size={22} aria-hidden="true" />
                </span>
                <h3>Keep context together</h3>
                <p>
                  Organize distinct portfolios in separate workspaces, with their own inventory,
                  connections and records.
                </p>
              </article>
              <article>
                <span className="about-principle-icon">
                  <ListChecks size={22} aria-hidden="true" />
                </span>
                <h3>Make the work visible</h3>
                <p>
                  Use manual entry, CSV imports and supported provider integrations to organize
                  domains, follow renewals and record financial activity.
                </p>
              </article>
              <article>
                <span className="about-principle-icon">
                  <SlidersHorizontal size={22} aria-hidden="true" />
                </span>
                <h3>Know what to expect</h3>
                <p>
                  Each provider exposes different capabilities. Review integration details and
                  account permissions availability before choosing how to connect.
                </p>
              </article>
            </div>
          </section>
        </Reveal>
        <Reveal>
          <section className="about-next-step">
            <div>
              <h2>Find the right fit for your portfolio.</h2>
              <p>Create a workspace and bring your domain records together.</p>
            </div>
            <div className="about-next-actions">
              <Link className="marketing-button" href="/register">
                Create an account <ArrowRight size={15} aria-hidden="true" />
              </Link>
              <Link className="marketing-outline" href="/contact">
                Contact Assame
              </Link>
            </div>
          </section>
        </Reveal>
      </main>
    </PublicFrame>
  );
}
