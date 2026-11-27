/** Editorial content is reviewed in the repository and published with the application. */
export type Article = {
  slug: string;
  title: string;
  description: string;
  publishedAt: string;
  updatedAt: string;
  sections: { heading: string; paragraphs: string[] }[];
};

export const articles: Article[] = [
  {
    slug: 'organize-domain-portfolios-across-workspaces',
    title: 'How to organize domain portfolios across workspaces',
    description:
      'A practical approach to separating portfolios, importing records and keeping renewal information useful.',
    publishedAt: '2026-11-10',
    updatedAt: '2026-11-10',
    sections: [
      {
        heading: 'Start with boundaries that make sense to you',
        paragraphs: [
          'A workspace can represent a personal portfolio, a client portfolio or another management context. Keep records together when the same people need to manage them together; separate them when their responsibilities or reporting need to stay distinct.',
          'In Assame, each workspace has its own domain inventory and connections. Check the workspace switcher before importing a file or connecting a provider so the records land in the intended portfolio.',
        ],
      },
      {
        heading: 'Prepare an inventory before importing',
        paragraphs: [
          'Export or assemble a list of the domains you manage, then review the names and the information you want to retain. Where available, include useful dates, costs and notes. Resolve obvious duplicates within the same portfolio before importing, and keep a copy of the original file.',
          'Use the CSV import or a supported provider connection, and review the results. Provider capabilities and permissions vary; a connection does not necessarily expose every listing, cost or renewal detail.',
        ],
      },
      {
        heading: 'Review renewals and financial records regularly',
        paragraphs: [
          'A portfolio view is most useful when its dates and costs are current. Review upcoming renewals, fill in missing acquisition information where you have it, and record sales as they happen. Verify critical renewal dates and payment arrangements with the registrar; the portfolio is a management aid, not a substitute for the registrar account.',
          'Use a regular review to archive records that no longer need active management and check that the right people can access each workspace. Use the available exports when you need a copy of supported portfolio records for your own reporting.',
        ],
      },
    ],
  },
  {
    slug: 'domain-renewal-review-checklist',
    title: 'A practical domain renewal review checklist',
    description:
      'Review upcoming expirations, renewal costs and registrar settings before making portfolio decisions.',
    publishedAt: '2026-11-10',
    updatedAt: '2026-11-10',
    sections: [
      {
        heading: 'Start with a reliable list',
        paragraphs: [
          'Gather your active registrations and sort them by expiration date. Include the registrar, renewal estimate, currency and any notes that explain why a name is held. Treat missing dates or costs as items to investigate, not as proof that a renewal is free or unnecessary.',
          'If a provider connection supplies dates, check when it was last synchronized. A portfolio record is a planning aid; the registrar remains the place to verify the current registration and make the renewal.',
        ],
      },
      {
        heading: 'Review the decision and the payment path',
        paragraphs: [
          'For each upcoming renewal, decide whether to keep the name, review it again, or let it expire. Consider the domain’s purpose, carrying cost, current use and the consequences of losing access. Keep client and personal portfolios separate when different people make those decisions.',
          'Confirm the registrar’s auto-renew setting and payment method directly with the registrar. Provider settings and renewal procedures vary; do not assume that recording a date or cost in a portfolio tool changes a registrar setting or renews a name.',
        ],
      },
      {
        heading: 'Record the outcome',
        paragraphs: [
          'After renewing, update the recorded expiration date and cost from the registrar’s confirmation. If a renewal is not going ahead, keep a note of the decision and monitor the name until the registrar shows the outcome.',
          'Review the list regularly instead of relying on a single annual cleanup. Give yourself enough lead time to resolve missing information or a payment issue before an important deadline.',
        ],
      },
    ],
  },
  {
    slug: 'track-domain-sales-and-installments',
    title: 'How to track domain sales and installment payments',
    description: 'Separate a sale agreement from cash received, fees and the remaining balance.',
    publishedAt: '2026-11-10',
    updatedAt: '2026-11-10',
    sections: [
      {
        heading: 'Separate the agreement from the cash',
        paragraphs: [
          'A signed sale or lease-to-own agreement describes an amount the buyer has agreed to pay. It is not the same as money already received. Record the agreement date, gross amount, currency and payment schedule, then record each payment when it is actually received.',
          'Use the marketplace or payment provider’s statement to reconcile individual payments. A marketplace observation is useful evidence to review, but it should not automatically be treated as a cash receipt without confirmation.',
        ],
      },
      {
        heading: 'Account for fees without counting them twice',
        paragraphs: [
          'Keep the gross sale amount separate from commissions and other costs. If a marketplace withholds a fee before paying you, record the withheld amount and the net payout consistently; otherwise the same fee can be subtracted twice.',
          'Keep a reference for each payment and compare the remaining balance with the agreement. Investigate discrepancies rather than assuming that an installment was paid merely because its due date has passed.',
        ],
      },
      {
        heading: 'Review completion and reporting',
        paragraphs: [
          'Check the agreement, payment history and provider records before marking a sale complete. In Assame, a completed sale no longer consumes an active domain slot; its financial history remains available.',
          'Portfolio reports are management tools. Keep source statements and consult an appropriately qualified adviser for accounting or tax treatment in your circumstances.',
        ],
      },
    ],
  },
  {
    slug: 'organize-domain-portfolio-costs',
    title: 'Organizing acquisition and holding costs for a domain portfolio',
    description: 'Build a clearer cost history without confusing estimates, expenses and proceeds.',
    publishedAt: '2026-11-10',
    updatedAt: '2026-11-10',
    sections: [
      {
        heading: 'Keep the original acquisition record',
        paragraphs: [
          'For each domain, retain the purchase date, acquisition amount, currency and a reference to the supporting record when available. If an amount is unknown, investigate it rather than treating an estimate as a confirmed purchase price.',
          'When the same domain is represented in separate workspaces, decide which portfolio owns each cost record. Separate workspace records are not automatically a consolidated accounting ledger.',
        ],
      },
      {
        heading: 'Distinguish estimates from actual costs',
        paragraphs: [
          'An upcoming renewal estimate helps with planning, but it is not an expense already paid. Update the actual renewal cost after confirming the charge. Record other relevant expenses separately and retain the source documents.',
          'Keep currencies clear. Adding amounts in different currencies without an explicit conversion can produce a misleading total; use the source currency and a consistent reporting process.',
        ],
      },
      {
        heading: 'Compare costs with verified proceeds',
        paragraphs: [
          'When a domain sells, compare its recorded investment and fees with payments actually collected. A quoted asking price or unpaid installment is not cash received.',
          'Review missing costs, duplicate fees and incomplete payment records before using a portfolio report to make decisions. Use accounting and tax advice appropriate to your circumstances for formal reporting.',
        ],
      },
    ],
  },
];

export function getArticle(slug: string): Article | undefined {
  return articles.find((article) => article.slug === slug);
}
