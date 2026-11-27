import type { Context } from './access';
import { db } from './db';
import { providers, providerIdForName } from '@/integrations/catalog';
import { requireRole } from './permissions';
import { lookupRegistration } from './rdap';
import { audit } from './portfolio';
import { AppError } from './security';
import { lockWritableWorkspace } from './workspace-write';
import { lookupPublicNameservers } from './public-nameservers';
import type { Prisma } from '@prisma/client';

const unknown = (registrar: string) =>
  !registrar.trim() || registrar.trim().toLowerCase() === 'unknown';
const registrarKey = (name: string) => providerIdForName(name) ?? name.trim().toLowerCase();

export async function fillPublicRegistrations(
  ctx: Context,
  ids: string[],
  beforeSave?: (tx: import('@prisma/client').Prisma.TransactionClient) => Promise<void>,
) {
  requireRole(ctx);
  if (ctx.org.demo)
    throw new AppError('Public registration lookup is unavailable in the demo workspace.', 409);
  const where = { organizationId: ctx.org.id, deletedAt: null };
  const domains = await db.domain.findMany({
    where: { ...where, id: { in: ids } },
    select: { id: true, name: true, registrations: true },
  });
  const totals = { updated: 0, unchanged: 0, unavailable: 0 };
  for (let start = 0; start < domains.length; start += 4) {
    const batch = await Promise.all(
      domains.slice(start, start + 4).map(async (domain) => {
        const missingMetadata = !domain.registrations.some(
          (row) => !unknown(row.registrar) && row.expiresAt,
        );
        const missingNameservers = !domain.registrations.some((row) => row.nameservers.length);
        const needed = missingMetadata || missingNameservers;
        const readRdap =
          missingMetadata || (missingNameservers && domain.registrations.length !== 1);
        const [initialObservation, dnsNameservers] = await Promise.all([
          readRdap ? lookupRegistration(domain.name).catch(() => null) : null,
          missingNameservers ? lookupPublicNameservers(domain.name).catch(() => []) : [],
        ]);
        const observation =
          missingNameservers && !dnsNameservers.length && !readRdap
            ? await lookupRegistration(domain.name).catch(() => null)
            : initialObservation;
        const nameservers = dnsNameservers.length
          ? dnsNameservers
          : (observation?.nameservers ?? []);
        return {
          domain,
          needed,
          observation,
          nameservers,
          nameserverSource: dnsNameservers.length ? 'public-dns' : 'public-rdap',
        };
      }),
    );
    for (const { domain, needed, observation, nameservers, nameserverSource } of batch) {
      if (!needed) {
        totals.unchanged++;
        continue;
      }
      if (!observation?.registrar && !nameservers.length) {
        totals.unavailable++;
        continue;
      }
      const registrar = observation?.registrar;
      const changed = await db.$transaction(async (tx) => {
        await lockWritableWorkspace(tx, ctx, 'EDITOR', false, 'sync');
        await beforeSave?.(tx);
        const current = await tx.domain.findFirst({
          where: { ...where, id: domain.id, name: domain.name },
          select: { registrations: true },
        });
        if (!current) return false;
        const matching = current.registrations.filter(
          (row) => registrar && registrarKey(row.registrar) === registrarKey(registrar),
        );
        const placeholder =
          current.registrations.length === 1 && unknown(current.registrations[0].registrar)
            ? current.registrations[0]
            : undefined;
        const row =
          matching.length === 1
            ? matching[0]
            : (placeholder ??
              (current.registrations.length === 1 ? current.registrations[0] : undefined));
        if (!row && current.registrations.length) return false;
        const provider = registrar ? providerIdForName(registrar) : undefined;
        const publicRegistrar = provider ? providers[provider].name : registrar;
        const fields: string[] = [];
        if (row) {
          const data: Prisma.DomainRegistrationUpdateManyMutationInput = {};
          if (!row.providerAccountId && !row.verifiedAt && (placeholder || matching.length === 1)) {
            if (placeholder && publicRegistrar) {
              data.registrar = publicRegistrar;
              fields.push('registrar');
            }
            if (!row.expiresAt && observation?.expiresAt) {
              data.expiresAt = observation.expiresAt;
              fields.push('expiresAt');
            }
            if (!row.registeredAt && observation?.registeredAt) {
              data.registeredAt = observation.registeredAt;
              fields.push('registeredAt');
            }
            if (fields.length) data.source = 'public-rdap';
          }
          if (
            nameservers.length &&
            !current.registrations.some((registration) => registration.nameservers.length)
          ) {
            data.nameservers = nameservers;
            fields.push('nameservers');
          }
          if (!fields.length) return false;
          const saved = await tx.domainRegistration.updateMany({
            where: {
              id: row.id,
              ...(fields.includes('nameservers') ? { nameservers: { isEmpty: true } } : {}),
            },
            data,
          });
          if (!saved.count) return false;
        } else {
          await tx.domainRegistration.create({
            data: {
              registrar: publicRegistrar || 'Unknown',
              expiresAt: observation?.expiresAt,
              registeredAt: observation?.registeredAt,
              domainId: domain.id,
              nameservers,
              source: publicRegistrar ? 'public-rdap' : nameserverSource,
            },
          });
          if (publicRegistrar) fields.push('registrar');
          if (observation?.expiresAt) fields.push('expiresAt');
          if (observation?.registeredAt) fields.push('registeredAt');
          if (nameservers.length) fields.push('nameservers');
        }
        await audit(tx, ctx, 'registration.public_lookup', domain.id, {
          registrar:
            placeholder && publicRegistrar
              ? publicRegistrar
              : row?.registrar || publicRegistrar || 'Unknown',
          fields,
          ...(fields.includes('nameservers') ? { nameserverSource, nameservers } : {}),
        });
        return true;
      });
      if (changed) totals.updated++;
      else totals.unchanged++;
    }
  }
  return totals;
}
