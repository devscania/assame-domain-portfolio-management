import type { Context } from './access';
import { db } from './db';
import { providers, providerIdForName } from '@/integrations/catalog';
import { requireRole } from './permissions';
import { lookupRegistration } from './rdap';
import { audit } from './portfolio';
import { AppError } from './security';
import { lockWritableWorkspace } from './workspace-write';

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
        const needed = !domain.registrations.some(
          (row) => !unknown(row.registrar) && row.expiresAt,
        );
        const observation = needed ? await lookupRegistration(domain.name).catch(() => null) : null;
        return { domain, needed, observation };
      }),
    );
    for (const { domain, needed, observation } of batch) {
      if (!needed) {
        totals.unchanged++;
        continue;
      }
      if (!observation?.registrar) {
        totals.unavailable++;
        continue;
      }
      const registrar = observation.registrar;
      const changed = await db.$transaction(async (tx) => {
        await lockWritableWorkspace(tx, ctx, 'EDITOR', false, 'sync');
        await beforeSave?.(tx);
        const current = await tx.domain.findFirst({
          where: { ...where, id: domain.id, name: domain.name },
          select: { registrations: true },
        });
        if (
          !current ||
          current.registrations.some((row) => !unknown(row.registrar) && row.expiresAt)
        )
          return false;
        const matching = current.registrations.filter(
          (row) => registrarKey(row.registrar) === registrarKey(registrar),
        );
        const placeholder =
          current.registrations.length === 1 && unknown(current.registrations[0].registrar)
            ? current.registrations[0]
            : undefined;
        const row = matching.length === 1 ? matching[0] : placeholder;
        if (row?.providerAccountId || row?.verifiedAt || (!row && current.registrations.length))
          return false;
        const provider = providerIdForName(registrar);
        const data = {
          registrar:
            row && !placeholder ? row.registrar : provider ? providers[provider].name : registrar,
          expiresAt: row?.expiresAt ?? observation.expiresAt,
          registeredAt: row?.registeredAt ?? observation.registeredAt,
        };
        if (row) {
          if (
            !placeholder &&
            !(!row.expiresAt && data.expiresAt) &&
            !(!row.registeredAt && data.registeredAt)
          )
            return false;
          await tx.domainRegistration.update({
            where: { id: row.id },
            data: { ...data, source: 'public-rdap' },
          });
        } else {
          await tx.domainRegistration.create({
            data: { ...data, domainId: domain.id, nameservers: [], source: 'public-rdap' },
          });
        }
        await audit(tx, ctx, 'registration.public_lookup', domain.id, {
          registrar: data.registrar,
        });
        return true;
      });
      if (changed) totals.updated++;
      else totals.unchanged++;
    }
  }
  return totals;
}
