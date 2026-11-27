import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { hash } from 'argon2';
import { normalizeDomain, installments } from '../src/lib/domain';
const db = new PrismaClient();
async function main() {
  for (const [id, name, kind] of [
    ['afternic', 'Afternic', 'marketplace'],
    ['spaceship', 'Spaceship', 'registrar + marketplace'],
    ['dynadot', 'Dynadot', 'registrar'],
    ['namecheap', 'Namecheap', 'registrar'],
    ['godaddy', 'GoDaddy', 'registrar'],
    ['atom', 'Atom', 'marketplace'],
    ['atomRegistrar', 'Atom Registrar', 'registrar'],
  ])
    await db.provider.upsert({ where: { id }, create: { id, name, kind }, update: {} });
  if (process.env.DEMO_MODE !== 'true' || process.env.NODE_ENV === 'production') {
    console.log('Providers seeded. Synthetic demo is disabled.');
    return;
  }
  const passwordHash = await hash('AssameDemo!2026', { type: 2 });
  const user = await db.user.upsert({
    where: { email: 'demo@assame.local' },
    create: {
      email: 'demo@assame.local',
      name: 'Alex Morgan',
      passwordHash,
    },
    update: {},
  });
  const org = await db.organization.upsert({
    where: { id: 'demo-workspace' },
    create: {
      id: 'demo-workspace',
      name: 'Horizon Portfolio',
      workspaceOwnerId: user.id,
      demo: true,
      members: { create: { userId: user.id, role: 'OWNER' } },
    },
    update: {},
  });
  // Separate real workspace allows CSV and live integrations without mixing synthetic records.
  await db.organization.upsert({
    where: { id: 'local-evaluation' },
    create: {
      id: 'local-evaluation',
      name: 'My real portfolio',
      workspaceOwnerId: user.id,
      members: { create: { userId: user.id, role: 'OWNER' } },
    },
    update: {},
  });
  if (await db.domain.count({ where: { organizationId: org.id } })) {
    console.log('Demo already seeded; existing records preserved.');
    return;
  }
  const names = [
    'horizon.com',
    'orbit.studio',
    'makewaves.io',
    'nextchapter.com',
    'brightpath.ai',
    'evergreen.co',
    'fieldwork.com',
    'northstar.io',
    'openwater.com',
    'clearspace.ai',
    'goodthings.co',
    'wildflower.com',
    'firewall.gg',
    'colors.gg',
    'futureproof.io',
    'gather.studio',
  ];
  const prefixes = [
    'hello',
    'bright',
    'fresh',
    'made',
    'get',
    'use',
    'meet',
    'try',
    'with',
    'hey',
    'join',
    'go',
    'open',
    'next',
  ];
  const stems = ['harbor', 'canvas', 'meadow', 'nest', 'signal', 'atlas', 'grove', 'spark'];
  const extensions = ['com', 'io', 'ai', 'co', 'com', 'com', 'studio'];
  for (let i = 0; i < 128; i++) {
    const name =
      names[i] ||
      `${prefixes[Math.floor((i - 16) / 8)]}${stems[(i - 16) % 8]}.${extensions[i % extensions.length]}`;
    const norm = normalizeDomain(name);
    const acquired = new Date();
    acquired.setUTCMonth(acquired.getUTCMonth() - (i % 8));
    acquired.setUTCDate(1 + (i % 27));
    const expiry = new Date(Date.now() + (i < 8 ? 8 + i * 4 : 40 + i * 2) * 86400000);
    const registrar = ['Spaceship', 'Dynadot', 'Namecheap', 'GoDaddy'][i % 4];
    const cost = String([12.98, 125, 89, 450, 32, 299, 1500, 21.99][i % 8]);
    const price = 1499 + (i % 12) * 500;
    const domain = await db.domain.create({
      data: {
        organizationId: org.id,
        ...norm,
        source: 'demo',
        confidence: 'synthetic-demo',
        acquisitionCost: cost,
        askingPrice: price,
        acquiredAt: acquired,
        createdAt: acquired,
        registrations: {
          create: {
            registrar,
            expiresAt: expiry,
            registeredAt: acquired,
            renewalCost: norm.tld === 'ai' ? '79.98' : norm.tld === 'io' ? '39.98' : '12.98',
            currency: 'USD',
            nameservers: ['ns1.example.net', 'ns2.example.net'],
            source: 'demo',
          },
        },
      },
    });
    if (i % 7 !== 0) {
      for (const marketplace of ['afternic', 'atom', 'spaceship']) {
        if (marketplace === 'atom' && i % 3 !== 0) continue;
        if (marketplace === 'spaceship' && i % 4 === 0) continue;
        await db.domainListing.create({
          data: {
            domainId: domain.id,
            marketplace,
            binPrice: price + (i % 11 === 0 && marketplace === 'atom' ? 500 : 0),
            minOffer: 100,
            currency: 'USD',
            source: 'demo',
            status: 'listed',
            verifiedAt: null,
            analytics: marketplace === 'afternic' ? { views: i * 19, leads: i % 5 } : undefined,
            lto: marketplace === 'afternic' ? { enabled: i % 3 === 0, maxPeriod: 24 } : undefined,
          },
        });
      }
    }
    const tag = await db.domainTag.upsert({
      where: {
        organizationId_name: {
          organizationId: org.id,
          name:
            i % 4 === 0
              ? 'Premium'
              : i % 4 === 1
                ? 'Brandable'
                : i % 4 === 2
                  ? 'Technology'
                  : 'Growth',
        },
      },
      create: {
        organizationId: org.id,
        name:
          i % 4 === 0
            ? 'Premium'
            : i % 4 === 1
              ? 'Brandable'
              : i % 4 === 2
                ? 'Technology'
                : 'Growth',
      },
      update: {},
    });
    await db.domainTagAssignment.create({ data: { domainId: domain.id, tagId: tag.id } });
    if (i >= 118) {
      const lto = i === 118;
      const gross = lto ? '1545' : String(1500 + i * 12);
      const soldAt = new Date();
      soldAt.setUTCMonth(soldAt.getUTCMonth() - ((i - 118) % 6));
      soldAt.setUTCDate(7);
      const schedule = installments(gross, lto ? 17 : 1);
      const sale = await db.domainSale.create({
        data: {
          domainId: domain.id,
          marketplace: ['Afternic', 'SellerHub', 'Private'][i % 3],
          grossAmount: gross,
          currency: 'USD',
          source: 'demo',
          kind: lto ? 'lto' : 'outright',
          status: lto ? 'paying' : 'completed',
          soldAt,
          commissions: {
            create: { amount: lto ? '154.50' : String(Number(gross) * 0.15), currency: 'USD' },
          },
          installments: {
            create: schedule.map((amount, index) => {
              const due = new Date(soldAt);
              due.setUTCMonth(due.getUTCMonth() + index);
              return { amount, dueAt: due, sequence: index + 1 };
            }),
          },
        },
      });
      await db.salePayment.create({
        data: {
          saleId: sale.id,
          amount: lto ? schedule[0] : gross,
          currency: 'USD',
          reference: 'synthetic-seed-payment',
          receivedAt: soldAt,
        },
      });
      await db.domain.update({ where: { id: domain.id }, data: { status: lto ? 'lto' : 'sold' } });
    }
  }
  for (const [action, hours] of [
    ['demo.portfolio_seeded', 48],
    ['demo.sales_recorded', 36],
    ['demo.listings_imported', 24],
    ['demo.renewals_reviewed', 12],
    ['demo.prices_compared', 2],
  ] as const)
    await db.auditLog.create({
      data: {
        organizationId: org.id,
        actorId: user.id,
        action,
        createdAt: new Date(Date.now() - hours * 3600000),
      },
    });
  await db.notification.create({
    data: {
      organizationId: org.id,
      title:
        'Welcome to your synthetic demo portfolio. Switch to My real portfolio to import real data and connect providers.',
    },
  });
  console.log('Seeded 128 explicitly synthetic demo domains and an empty personal workspace.');
}
main()
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
