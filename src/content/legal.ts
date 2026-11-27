export type LegalDocument = {
  title: string;
  description: string;
  updatedAt: string;
  sections: { heading: string; paragraphs: string[] }[];
};

export const privacy: LegalDocument = {
  title: 'Privacy policy',
  description: 'How Assame handles account, portfolio and website information.',
  updatedAt: '2026-11-10',
  sections: [
    {
      heading: 'Contact',
      paragraphs: ['For privacy questions or requests, use the contact form linked below.'],
    },
    {
      heading: 'Information used by the service',
      paragraphs: [
        'Account information can include your email address, name, password hash, email verification status, linked sign-in identifiers and preferences. Portfolio information includes the domain names, workspace members, notes, listings, renewals and financial records you add or synchronize.',
        'When you connect a provider, Assame stores the credentials needed for that connection in encrypted form.',
        'Contact requests contain the name, email and message you submit. The service also uses security and operational information, including hashed rate-limit identifiers and technical logs, to protect and run the application.',
      ],
    },
    {
      heading: 'How information is used and shared',
      paragraphs: [
        'Information is used to provide account access, maintain workspaces and portfolios, synchronize providers you connect, send requested or account-related messages, respond to requests and protect the service.',
        'Information is sent to service providers as needed for these functions, such as hosting and database providers, email delivery, a sign-in provider you choose, and registrars or marketplaces you connect. Their own terms and privacy practices apply to their services.',
      ],
    },
    {
      heading: 'Analytics and preferences',
      paragraphs: [
        'Optional site analytics is loaded only after you accept analytics. You can reject it or change your choice using Analytics preferences in the footer. A short-lived first-party cookie and session storage may record a selected sign-in provider for consented signup measurement. Analytics events are designed not to include email addresses, API credentials, portfolio records, private page URLs or payment details.',
        'Essential local storage and cookies support functions such as signing in, workspace selection, theme and your analytics choice. Blocking them may prevent those functions from working.',
      ],
    },
    {
      heading: 'Retention and requests',
      paragraphs: [
        'Account and portfolio information is retained while needed to provide the service. You can request account removal in account settings. Contact requests and operational records may also remain for support, security and recordkeeping.',
        'Depending on applicable law, you may have rights to access, correct or delete information, or to make other privacy requests. Use the contact form to make a request. Assame may need to verify your identity and retain information where required or permitted by law.',
      ],
    },
  ],
};

export const terms: LegalDocument = {
  title: 'Terms of service',
  description: 'Terms for using Assame and its domain portfolio management features.',
  updatedAt: '2026-11-10',
  sections: [
    {
      heading: 'Using Assame',
      paragraphs: [
        'Assame is a domain portfolio management service. By using the service, you agree to use it lawfully and only for domains and accounts you are authorized to manage.',
        'You are responsible for maintaining the security of your sign-in methods and for the actions of people you invite to your workspaces. Only connect provider accounts and share workspace access when you have authority to do so.',
      ],
    },
    {
      heading: 'Portfolio information and providers',
      paragraphs: [
        'Workspaces keep their portfolio records separate. Provider capabilities, permissions and synchronization results vary. Review changes before confirming them and verify important registration, renewal, listing and payment information with the relevant provider.',
        'Recording information in Assame does not by itself renew, purchase or transfer a domain. Third-party providers operate under their own terms, availability and restrictions.',
      ],
    },
    {
      heading: 'Questions and applicable rights',
      paragraphs: [
        'Use the contact form for questions about these terms or account access. These terms do not limit rights that cannot be waived under applicable law.',
      ],
    },
  ],
};
