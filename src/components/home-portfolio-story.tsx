'use client';

import { useRef, useSyncExternalStore, type CSSProperties, type ReactNode } from 'react';
import { m, useReducedMotion, useScroll, useTransform, type MotionValue } from 'motion/react';
import {
  ArrowDown,
  ArrowUpRight,
  Check,
  Clock3,
  FileSpreadsheet,
  Globe2,
  Layers3,
  ListChecks,
  RefreshCw,
  Wallet,
} from 'lucide-react';

const stackQuery = '(min-width: 900px) and (min-height: 740px)';
const subscribe = (callback: () => void) => {
  const query = window.matchMedia(stackQuery);
  query.addEventListener('change', callback);
  return () => query.removeEventListener('change', callback);
};
const stackViewport = () => window.matchMedia(stackQuery).matches;

function StoryCard({
  index,
  progress,
  enabled,
  children,
}: {
  index: number;
  progress: MotionValue<number>;
  enabled: boolean;
  children: ReactNode;
}) {
  const scale = useTransform(
    progress,
    [index * 0.34, (index + 1) * 0.34],
    [1, index === 2 ? 1 : 0.94],
  );
  return (
    <li className="portfolio-story-step" style={{ '--story-index': index } as CSSProperties}>
      <m.article
        className={`portfolio-story-card portfolio-story-card-${index + 1}`}
        style={{ scale: enabled ? scale : 1 }}
      >
        {children}
      </m.article>
    </li>
  );
}

/** The complete story is server-rendered. Sticky motion is progressive enhancement. */
export function HomePortfolioStory() {
  const target = useRef<HTMLOListElement>(null);
  const reducedMotion = useReducedMotion();
  const desktop = useSyncExternalStore(subscribe, stackViewport, () => false);
  const enabled = desktop && reducedMotion === false;
  const { scrollYProgress } = useScroll({ target, offset: ['start 18%', 'end 85%'] });
  return (
    <section
      className="portfolio-story"
      id="features"
      aria-labelledby="portfolio-story-title"
      data-stack-enabled={enabled}
    >
      <div className="portfolio-story-heading">
        <div>
          <span className="marketing-kicker">FROM SCATTERED DETAILS TO A CLEARER VIEW</span>
          <h2 id="portfolio-story-title">Bring the whole picture together.</h2>
        </div>
        <p>
          Your inventory is the starting point. Connect the work around it, then see what your
          portfolio is doing.
        </p>
      </div>
      <div className="portfolio-story-scroll-note" aria-hidden="true">
        <ArrowDown size={14} /> Scroll to bring it together
      </div>
      <ol ref={target} className="portfolio-story-stack">
        <StoryCard index={0} progress={scrollYProgress} enabled={enabled}>
          <div className="portfolio-story-copy">
            <span className="portfolio-story-number">01 / ORGANIZE</span>
            <span className="portfolio-story-symbol">
              <Globe2 size={25} aria-hidden="true" />
            </span>
            <h3>Unify your portfolio.</h3>
            <p>
              Give every domain a place. Bring records from different sources into one inventory,
              with the workspace structure to keep distinct portfolios separate.
            </p>
            <ul>
              <li>
                <Check size={15} /> Manual entry and CSV imports
              </li>
              <li>
                <Check size={15} /> Supported provider connections
              </li>
              <li>
                <Check size={15} /> Separate workspaces, one sign-in
              </li>
            </ul>
          </div>
          <div
            className="portfolio-story-demo story-inventory"
            aria-label="Illustrative domain inventory"
          >
            <div className="story-demo-toolbar">
              <span>
                <Layers3 size={16} /> Main portfolio
              </span>
              <span>Inventory</span>
            </div>
            <div className="story-source-row">
              <span>
                <FileSpreadsheet size={14} /> CSV import
              </span>
              <span>
                <Globe2 size={14} /> Manual entry
              </span>
              <span>
                <RefreshCw size={14} /> Provider sync
              </span>
            </div>
            <div className="story-inventory-table">
              <div className="story-table-label">
                <span>DOMAIN</span>
                <span>ORGANIZATION</span>
              </div>
              {['example.studio', 'example.design', 'example.digital'].map((name, i) => (
                <div key={name}>
                  <span>
                    <i />
                    {name}
                  </span>
                  <span>{i === 1 ? 'New project' : 'Main portfolio'}</span>
                </div>
              ))}
            </div>
            <div className="story-demo-bottom">
              <span className="story-status-dot" /> A shared view, with room for context.
            </div>
            <small className="story-demo-caption">Illustrative records · not a live account</small>
          </div>
        </StoryCard>
        <StoryCard index={1} progress={scrollYProgress} enabled={enabled}>
          <div className="portfolio-story-copy">
            <span className="portfolio-story-number">02 / KEEP THINGS MOVING</span>
            <span className="portfolio-story-symbol">
              <RefreshCw size={25} aria-hidden="true" />
            </span>
            <h3>Make room for better workflows.</h3>
            <p>
              Keep listings, renewal dates and provider activity close to the domains they belong
              to. Spend less time piecing the details together.
            </p>
            <ul>
              <li>
                <Check size={15} /> Synchronize supported listing data
              </li>
              <li>
                <Check size={15} /> Review upcoming renewal dates
              </li>
              <li>
                <Check size={15} /> Preview supported changes before confirming
              </li>
            </ul>
          </div>
          <div
            className="portfolio-story-demo story-workflow"
            aria-label="Illustrative portfolio workflow"
          >
            <div className="story-demo-toolbar">
              <span>
                <ListChecks size={16} /> The work around your domains
              </span>
            </div>
            <div className="story-workflow-row">
              <span className="story-workflow-icon">
                <RefreshCw size={19} />
              </span>
              <div>
                <strong>Bring the latest details in</strong>
                <p>Review supported provider synchronization</p>
              </div>
              <ArrowDown size={15} />
            </div>
            <div className="story-workflow-row">
              <span className="story-workflow-icon">
                <Clock3 size={19} />
              </span>
              <div>
                <strong>See what needs attention</strong>
                <p>Keep upcoming renewal dates in view</p>
              </div>
              <ArrowDown size={15} />
            </div>
            <div className="story-workflow-row">
              <span className="story-workflow-icon">
                <ListChecks size={19} />
              </span>
              <div>
                <strong>Choose your next action</strong>
                <p>Preview and confirm supported provider changes</p>
              </div>
              <Check size={16} />
            </div>
            <small className="story-demo-caption">
              Capabilities and permissions vary by provider.
            </small>
          </div>
        </StoryCard>
        <StoryCard index={2} progress={scrollYProgress} enabled={enabled}>
          <div className="portfolio-story-copy">
            <span className="portfolio-story-number">03 / UNDERSTAND</span>
            <span className="portfolio-story-symbol">
              <Wallet size={25} aria-hidden="true" />
            </span>
            <h3>Put performance in context.</h3>
            <p>
              Connect the portfolio you own with the activity you record. See costs, renewals and
              completed sales together, so the next decision starts with a clearer picture.
            </p>
            <ul>
              <li>
                <Check size={15} /> Record acquisition and renewal costs
              </li>
              <li>
                <Check size={15} /> Follow recorded sales and revenue
              </li>
              <li>
                <Check size={15} /> Review portfolio financial history
              </li>
            </ul>
          </div>
          <div
            className="portfolio-story-demo story-performance"
            aria-label="Illustrative financial history structure"
          >
            <div className="story-demo-toolbar">
              <span>
                <Wallet size={16} /> Portfolio financial history
              </span>
              <ArrowUpRight size={16} />
            </div>
            <div className="story-financial-heading">
              <span>EVERY RECORD ADDS CONTEXT</span>
              <strong>See the activity behind your inventory.</strong>
            </div>
            <div className="story-financial-record">
              <span className="story-financial-marker" />
              <div>
                <strong>Acquisition</strong>
                <span>Your starting investment</span>
              </div>
              <span>Cost</span>
            </div>
            <div className="story-financial-record">
              <span className="story-financial-marker" />
              <div>
                <strong>Renewal</strong>
                <span>The cost of keeping a domain</span>
              </div>
              <span>Cost</span>
            </div>
            <div className="story-financial-record">
              <span className="story-financial-marker" />
              <div>
                <strong>Completed sale</strong>
                <span>Recorded portfolio activity</span>
              </div>
              <span>Revenue</span>
            </div>
            <small className="story-demo-caption">
              Illustrative categories · your records tell your story
            </small>
          </div>
        </StoryCard>
      </ol>
    </section>
  );
}
