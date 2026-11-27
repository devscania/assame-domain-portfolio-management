import { providers, type ProviderId } from './catalog';

type Guide = {
  fields: { name: string; description: string }[];
  steps: string[];
  eligibility: string;
  limitations: string;
  sources: { title: string; url: string }[];
};

export const providerGuides: Record<ProviderId, Guide> = {
  godaddy: {
    fields: [
      {
        name: 'Personal Access Token',
        description:
          'A GoDaddy PAT with domains.domain:read. A classic key/secret pair is not accepted by this v3 connection.',
      },
    ],
    steps: [
      'Open GoDaddy’s developer dashboard and its Personal Access Token page.',
      'Generate a named token, choose an expiry and grant only domains.domain:read.',
      'Copy the token when it is shown and save it in this workspace’s GoDaddy connection. Test the connection before starting a read-only sync.',
    ],
    eligibility:
      'GoDaddy currently requires at least one domain or an eligible management-access plan. A valid token can still be refused when the account is ineligible or lacks the scope.',
    limitations:
      'Assame reads registered and expiring inventory, dates, auto-renew and nameservers. It does not register, renew, transfer, change DNS or manage GoDaddy marketplace listings.',
    sources: [
      {
        title: 'Generate a GoDaddy PAT',
        url: 'https://developer.godaddy.com/en/docs/api-users/auth/how-to',
      },
      {
        title: 'Scopes and eligibility',
        url: 'https://developer.godaddy.com/en/docs/api-users/auth',
      },
      { title: 'Registered domain API', url: providers.godaddy.docs },
    ],
  },
  afternic: {
    fields: [
      { name: 'API key', description: 'Your Afternic Portfolio API key.' },
      { name: 'API secret', description: 'The secret issued with that key.' },
    ],
    steps: [
      'Sign in to Afternic and open your account profile.',
      'Find API keys, select Add Key and give it a recognizable name.',
      'Store the key and secret securely, then enter both in the Afternic connection for the intended workspace.',
      'Test access and compare a read-only sync with your Afternic portfolio before considering confirmed writes.',
    ],
    eligibility:
      'Afternic announced Portfolio API access for all sellers. Account terms, account permissions and data access still apply; some statistics require additional membership.',
    limitations:
      'Listings, prices, available sales and statistics are supported. Keys can authorize live changes; connecting does not enable automatic writes. Only actions exposed with an exact confirmation are implemented. Use this connection only when your Afternic account terms permit credential access through Assame.',
    sources: [
      { title: 'Afternic setup announcement', url: 'https://blog.afternic.com/portfolio-api/' },
      { title: 'Portfolio API reference', url: providers.afternic.docs },
      {
        title: 'Afternic membership terms',
        url: 'https://www.afternic.com/legal/agreements/membership-agreement',
      },
    ],
  },
  spaceship: {
    fields: [
      { name: 'API key', description: 'The key created in Spaceship API Manager.' },
      { name: 'API secret', description: 'The matching API secret.' },
    ],
    steps: [
      'Sign in to Spaceship and open API Manager.',
      'Choose New API key, name the connection and select domains:read and sellerhub:read for the existing inventory/listing checks.',
      'Copy the key and secret into the workspace connection and test access.',
      'Add write scopes only for a supported action you intend to confirm: sellerhub:write for listings, domains:write for nameservers.',
    ],
    eligibility:
      'The account must be able to create API credentials and access the selected resources. SellerHub reads and registrar reads have distinct permissions.',
    limitations:
      'Inventory and SellerHub data are read during synchronization. Supported writes require workspace opt-in and explicit previews. Async provider responses and DNS propagation are not assumed complete.',
    sources: [
      { title: 'Spaceship API authentication and permissions', url: providers.spaceship.docs },
    ],
  },
  dynadot: {
    fields: [
      { name: 'API key', description: 'Production Key from Dynadot Tools → API.' },
      {
        name: 'API secret',
        description:
          'Secret Key for RESTful v2 signing; optional only for the existing legacy API3 fallback.',
      },
    ],
    steps: [
      'Sign in to Dynadot, open Tools → API and unlock the account on that page.',
      'Copy the Production Key and its Secret Key, rather than the sandbox pair.',
      'If the key is IP-restricted, allow the deployment worker’s outbound IP and allow time for Dynadot’s change to propagate.',
      'Save the connection, test access and run a read-only inventory/listing sync.',
    ],
    eligibility:
      'API access, account tier, IP restrictions and provider rate limits apply. The Secret Key signs requests that require RESTful v2 authentication.',
    limitations:
      'Assame reads inventory and available marketplace listings. Seller sales and payouts are not imported; record these from your seller statement on Sales & revenue. Purchase order history is not seller revenue. Only supported, confirmed price/listing operations are implemented; uncertain mutations are not blindly retried.',
    sources: [
      {
        title: 'Find Dynadot API settings',
        url: 'https://www.dynadot.com/help/question/find-API-settings',
      },
      { title: 'Dynadot API reference', url: 'https://www.dynadot.com/domain/api-document' },
    ],
  },
  namecheap: {
    fields: [
      { name: 'API key', description: 'The API key for your Namecheap production account.' },
      { name: 'Namecheap username', description: 'Your account username, not an email address.' },
      {
        name: 'Allowlisted public IPv4',
        description:
          'The worker deployment’s outbound IPv4, also added to Namecheap’s API allowlist.',
      },
    ],
    steps: [
      'Open Namecheap Profile → Tools → Business & Dev Tools → Namecheap API Access.',
      'Enable API access when eligible, copy the key and confirm the account username.',
      'Allowlist the worker deployment’s outbound public IPv4. Your browser’s IP may be different.',
      'Enter all three values, test the connection and synchronize inventory.',
    ],
    eligibility:
      'Namecheap currently lists alternative requirements: 20 domains, a $50 account balance, or $50 spent in the preceding two years. Check its current policy or ask support if access is unavailable.',
    limitations:
      'Inventory, dates and auto-renew are read. Supported custom nameserver changes use a separate confirmed workflow. Arbitrary DNS-record replacement, purchases and paid renewals are not implemented.',
    sources: [
      {
        title: 'Namecheap API eligibility FAQ',
        url: 'https://www.namecheap.com/support/knowledgebase/article.aspx/9739/63/api-faq/',
      },
      { title: 'Namecheap inventory API', url: providers.namecheap.docs },
    ],
  },
  sedo: {
    fields: [
      {
        name: 'Partner ID and sign key',
        description: 'The credentials issued by Sedo for Basic API access.',
      },
      {
        name: 'Sedo username and password',
        description: 'The credentials for the Sedo account whose listings you want to manage.',
      },
    ],
    steps: [
      'Request Basic API access from partners@sedo.com.',
      'Save the four credentials in the Sedo connection.',
      'Test the connection and synchronize your listings.',
    ],
    eligibility: 'Sedo must grant the account access to the Basic API.',
    limitations:
      'Assame syncs listing status and prices, creates USD Buy Now listings, edits BIN prices in the existing currency, and delists domains while retaining their Sedo portfolio entries.',
    sources: [
      { title: 'Sedo Basic API', url: providers.sedo.docs },
      {
        title: 'Sedo partner integrations',
        url: 'https://sedo.com/member/partner/integration.php?language=us',
      },
    ],
  },
  atom: {
    fields: [
      {
        name: 'Seller API token',
        description: 'An approved Atom Seller API token with seller.read access.',
      },
      {
        name: 'Atom seller user ID',
        description:
          'The numeric seller user_id associated with that token, as required by the seller API.',
      },
    ],
    steps: [
      'Request Seller API access from Atom if the API Access section is not enabled.',
      'In the seller dashboard, open API Access and generate or regenerate the seller token.',
      'Obtain the associated numeric seller user ID from the API-access details or Atom support.',
      'Save both values. Begin with seller.read; add seller.write only for supported actions you intend to confirm.',
    ],
    eligibility:
      'Atom describes Seller API access as a limited beta requiring approval, with at least 500 listings for consideration. Approval is not guaranteed by adding credentials here.',
    limitations:
      'Seller listings, prices and available analytics are separate from registrar inventory. Premium submissions that spend a coin are excluded. Standard listings support confirmed creation and removal. Manage Plus and Premium removals through Atom.',
    sources: [
      {
        title: 'Atom API access and eligibility',
        url: 'https://www.atom.com/help/article/atom-seller-api-access',
      },
      { title: 'Atom Seller API', url: providers.atom.docs },
      { title: 'Atom developer platform', url: 'https://www.atom.com/developer' },
    ],
  },
  atomRegistrar: {
    fields: [
      {
        name: 'Registrar API token',
        description:
          'An approved Atom Registrar bearer token with registrar read access. A Seller API token alone is insufficient.',
      },
    ],
    steps: [
      'Request Registrar API access from Atom; it is separate from Seller API approval.',
      'Generate the registrar token from the approved API Access dashboard.',
      'Save it under Atom Registrar in the intended workspace and test read access.',
      'Use registrar read permissions; DNS editing is not available in Assame.',
    ],
    eligibility:
      'Atom lists Registrar API consideration for accounts with 100 registrar domains and/or an active seller account, subject to approval and current policy.',
    limitations:
      'Assame reads registrar inventory and dates. DNS records and nameservers cannot be edited through this connection. Registration, renewal payments and transfers are not implemented.',
    sources: [
      {
        title: 'Atom API access and eligibility',
        url: 'https://www.atom.com/help/article/atom-seller-api-access',
      },
      { title: 'Atom Registrar API guide', url: providers.atomRegistrar.docs },
    ],
  },
};

export const providerSetupFaqs = [
  {
    question: 'Does connecting move my domains?',
    answer:
      'No. Connections associate provider reads with one workspace. Domain registration and ownership remain with the provider.',
  },
  {
    question: 'Where should I enter credentials?',
    answer:
      'Only in the workspace connection form. Assame encrypts saved credentials and does not return them after submission. Never paste keys into support messages, screenshots or public URLs.',
  },
  {
    question: 'Why can a valid key fail?',
    answer:
      'Account eligibility, expired credentials, missing permissions, IP allowlists or rate limits can prevent access. Check the provider-specific guide and official account settings; do not repeatedly create keys.',
  },
  {
    question: 'Will connecting change provider data?',
    answer:
      'Connection testing and synchronization are reads. Remote changes require supported actions, workspace opt-in and an explicit confirmed preview. GoDaddy is read-only in Assame.',
  },
  {
    question: 'Can I use CSV instead?',
    answer:
      'Yes. CSV import and export remain available when provider API access is unavailable. Review the import preview before confirming.',
  },
];
