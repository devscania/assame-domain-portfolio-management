import { browserOrigin } from './environment';
import { test, expect } from './fixtures';
import { db } from '../../src/lib/db';
import Decimal from 'decimal.js';

test('records a sold domain with net payout, displays profit and shows LTO forecasts without fabricated cash', async ({
  page,
  verifyFixtureEmail,
}) => {
  const email = `sale-finance-${Date.now()}@example.test`,
    password = 'FinanceFixture!2026secure';
  let orgId: string | undefined, userId: string | undefined;
  try {
    expect(
      (
        await page.request.post('/api/register', {
          headers: { Origin: browserOrigin, 'x-forwarded-for': email },
          data: {
            email,
            password,
            confirmPassword: password,
            name: 'Finance fixture',
            workspace: 'FINANCE FIXTURE',
          },
        })
      ).status(),
    ).toBe(200);
    await verifyFixtureEmail(email, page.request);
    const member = await db.organizationMember.findFirstOrThrow({ where: { user: { email } } });
    orgId = member.organizationId;
    userId = member.userId;
    const domain = await db.domain.create({
      data: {
        organizationId: orgId,
        name: 'sold-finance-fixture.test',
        unicodeName: 'sold-finance-fixture.test',
        tld: 'test',
        acquisitionCost: '12',
      },
    });
    const leaseDomain = await db.domain.create({
      data: {
        organizationId: orgId,
        name: 'lto-finance-fixture.test',
        unicodeName: 'lto-finance-fixture.test',
        tld: 'test',
        acquisitionCost: '12.50',
      },
    });
    const account = await db.providerAccount.create({
      data: {
        organizationId: orgId,
        providerId: 'afternic',
        label: 'UNVERIFIED FINANCE FIXTURE',
        syncEveryHours: 0,
      },
    });
    await db.providerSaleObservation.create({
      data: {
        providerAccountId: account.id,
        externalId: 'fixture-only-transaction',
        domainName: 'lto-finance-fixture.test',
        status: 'PAID_LEASE_INSTALLMENT',
        kind: 'LEASED',
        amount: '1545',
        commissionAmount: '309',
        installmentAmount: '75.34',
        currency: 'USD',
        soldAt: new Date('2026-07-07'),
        installments: 17,
        installmentsPaid: 4,
        previousInstallmentAt: new Date('2026-10-14'),
        nextInstallmentAt: new Date('2026-11-14'),
      },
    });
    await page.goto('/login');
    await page.getByLabel('Email address').fill(email);
    await page.getByLabel(/^Password/).fill(password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Portfolio overview' })).toBeVisible();
    await page.waitForLoadState('load');
    await page.goto(`/domains/${domain.id}`);
    await page.getByRole('button', { name: 'Record sale', exact: true }).click();
    await expect(page.getByRole('combobox', { name: 'Domain', exact: true })).toHaveValue(
      domain.id,
    );
    await page.getByLabel('Gross agreement amount', { exact: true }).fill('500');
    await page.getByLabel('Total commission', { exact: true }).fill('25');
    await page.getByLabel('Marketplace', { exact: true }).fill('Dynadot');
    await page.getByLabel('Agreement date', { exact: true }).fill('2026-10-06');
    await page.getByLabel('Net payout already received (optional)', { exact: true }).fill('475');
    await expect(
      page.getByRole('dialog').getByRole('textbox', { name: /commission/i }),
    ).toHaveCount(1);
    await page.getByRole('button', { name: 'Record agreement', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const sale = await db.domainSale.findFirstOrThrow({
      where: { domainId: domain.id },
      include: { payments: true },
    });
    expect(sale.status).toBe('completed');
    expect(sale.payments[0].commissionWithheld.toString()).toBe('25');
    expect(sale.payments[0].receivedAt).toBeNull();
    await page.goto('/sales');
    const row = page.getByRole('row').filter({
      has: page.getByRole('button', { name: 'sold-finance-fixture.test', exact: true }),
    });
    await expect(row.getByText('$463', { exact: true })).toBeVisible();
    await expect(row.getByRole('button', { name: 'Payment', exact: true })).toBeDisabled();
    const summary = await (await page.request.get('/api/console?view=summary')).json();
    expect(new Decimal(summary.collected).eq('475')).toBe(true);
    expect(new Decimal(summary.unpaid).eq('0')).toBe(true);
    expect(new Decimal(summary.realized).eq('463')).toBe(true);
    expect(new Decimal(summary.undatedCash).eq('475')).toBe(true);
    await page
      .getByRole('button', { name: 'View reported sale for lto-finance-fixture.test', exact: true })
      .click();
    const report = page.getByRole('dialog');
    await expect(report.getByText('$1,236', { exact: true })).toBeVisible();
    await expect(report.getByText('$1,223.50', { exact: true })).toBeVisible();
    await expect(
      report.getByText('Recorded cash receipts: Not reconciled', { exact: true }),
    ).toBeVisible();
    await expect(report.getByText('Seller payout date:', { exact: true })).toBeVisible();
    await expect(report.getByText(/Seller payout date: Not reported/)).toBeVisible();
    await report.getByRole('button', { name: 'Record sale and payout' }).click();
    await expect(page.getByRole('heading', { name: 'Record a lease-to-own sale' })).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Domain', exact: true })).toHaveValue(
      leaseDomain.id,
    );
    await expect(page.getByLabel('Installments (1 = outright)')).toHaveValue('17');
    await page.getByLabel('Net payout already received (optional)', { exact: true }).fill('60');
    await page.getByLabel('Payment received date (optional)', { exact: true }).fill('2026-10-21');
    await page.getByRole('button', { name: 'Record agreement', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const lease = await db.domainSale.findFirstOrThrow({
      where: { domainId: leaseDomain.id },
      include: { installments: true, payments: true },
    });
    expect(lease.kind).toBe('lto');
    expect(lease.installments).toHaveLength(17);
    expect(lease.payments).toHaveLength(1);
    expect(lease.payments[0].amount.toString()).toBe('60');
    const withLease = await (await page.request.get('/api/console?view=summary')).json();
    expect(new Decimal(withLease.collected).eq('535')).toBe(true);
    await page
      .getByRole('button', { name: 'View reported sale for lto-finance-fixture.test', exact: true })
      .click();
    await report.getByRole('button', { name: 'Record received payout', exact: true }).click();
    const providerReceipt = page.getByRole('dialog', { name: 'Record a received payment' });
    await expect(providerReceipt.getByLabel('Amount received (USD)', { exact: true })).toHaveValue(
      '',
    );
    await expect(providerReceipt.getByLabel('Received on', { exact: true })).toHaveValue('');
    await providerReceipt.getByLabel('Amount received (USD)', { exact: true }).fill('100');
    await providerReceipt
      .getByLabel('Payment reference', { exact: true })
      .fill('confirmed-seller-payout');
    await providerReceipt.getByLabel('Received on', { exact: true }).fill('2026-10-25');
    await providerReceipt.getByRole('button', { name: 'Record payment', exact: true }).click();
    await expect(providerReceipt).toHaveCount(0);
    const confirmed = await db.salePayment.findUniqueOrThrow({
      where: { saleId_reference: { saleId: lease.id, reference: 'confirmed-seller-payout' } },
    });
    expect(confirmed.amount.toString()).toBe('100');
    expect(confirmed.receivedAt?.toISOString().slice(0, 10)).toBe('2026-10-25');
    const afterPayout = await (await page.request.get('/api/console?view=summary')).json();
    expect(new Decimal(afterPayout.collected).eq('635')).toBe(true);
    expect(afterPayout.providerSales[0].installmentsPaid).toBe(4);
    const leaseRow = page.getByRole('row').filter({
      has: page.getByRole('button', { name: 'lto-finance-fixture.test', exact: true }),
    });
    await leaseRow.getByRole('button', { name: 'Payment', exact: true }).click();
    const receipt = page.getByRole('dialog', { name: 'Record a received payment' });
    await expect(receipt.getByRole('textbox', { name: /commission/i })).toHaveCount(0);
    await receipt.getByLabel('Amount received (USD)', { exact: true }).fill('1076');
    await receipt.getByLabel('Payment reference', { exact: true }).fill('final-net-payout');
    await receipt.getByRole('button', { name: 'Record payment', exact: true }).click();
    await expect(receipt).toHaveCount(0);
    await expect(leaseRow.getByRole('button', { name: 'Payment', exact: true })).toBeDisabled();
    const finalPayout = await db.salePayment.findUniqueOrThrow({
      where: { saleId_reference: { saleId: lease.id, reference: 'final-net-payout' } },
    });
    expect(finalPayout.commissionWithheld.toString()).toBe('309');
    await page
      .getByRole('button', { name: 'View reported sale for lto-finance-fixture.test', exact: true })
      .click();
    await expect(
      report.getByRole('button', { name: 'Agreement fully received', exact: true }),
    ).toBeDisabled();
    await report.getByRole('button', { name: 'Close dialog', exact: true }).click();
    await page.goto('/sync');
    await expect(page.getByRole('heading', { name: 'Activity center', exact: true })).toBeVisible();
    await expect(page.getByText('Payout recorded', { exact: true }).first()).toBeVisible();
    await page.goto('/sales');
    await page.getByRole('button', { name: 'sold-finance-fixture.test', exact: true }).click();
    await page.getByRole('button', { name: 'Set received date', exact: true }).click();
    await expect(
      page
        .getByRole('dialog', { name: 'Edit payout & collected cash' })
        .getByRole('textbox', { name: /commission/i }),
    ).toHaveCount(0);
    await page.getByLabel('Actual received date', { exact: true }).fill('2026-10-08');
    const dateSaved = page.waitForResponse(
      (r) =>
        r.url().endsWith('/api/console') && r.request().postDataJSON()?.action === 'payment.update',
    );
    await page.getByRole('button', { name: 'Save payment changes', exact: true }).click();
    expect((await dateSaved).status()).toBe(200);
    expect(
      (await db.salePayment.findFirstOrThrow({ where: { saleId: sale.id } })).receivedAt
        ?.toISOString()
        .slice(0, 10),
    ).toBe('2026-10-08');

    const change = (action: string, data: Record<string, string>) =>
      page.request.post('/api/console', {
        headers: { Origin: browserOrigin },
        data: { action, data },
      });
    expect(
      (await change('payment.update', { paymentId: sale.payments[0].id, amount: '480' })).ok(),
    ).toBe(true);
    expect((await change('sale.update', { saleId: sale.id, commission: '20' })).ok()).toBe(true);
    const corrected = await db.domainSale.findUniqueOrThrow({
      where: { id: sale.id },
      include: { payments: true, commissions: true },
    });
    expect(corrected.status).toBe('completed');
    expect(corrected.commissions.map((fee) => fee.amount.toString())).toEqual(['20']);
    expect(corrected.payments[0].amount.toString()).toBe('480');
    expect(corrected.payments[0].commissionWithheld.toString()).toBe('20');
    expect(corrected.payments[0].receivedAt?.toISOString().slice(0, 10)).toBe('2026-10-08');
    await db.$transaction([
      db.salePayment.update({
        where: { id: corrected.payments[0].id },
        data: { commissionWithheld: '0' },
      }),
      db.domainSale.update({ where: { id: sale.id }, data: { status: 'paying' } }),
    ]);
    expect((await change('sale.update', { saleId: sale.id, commission: '20' })).ok()).toBe(true);
    expect((await db.domainSale.findUniqueOrThrow({ where: { id: sale.id } })).status).toBe(
      'completed',
    );
  } finally {
    if (orgId) await db.organization.delete({ where: { id: orgId } });
    if (userId) await db.user.delete({ where: { id: userId } });
    await db.$disconnect();
  }
});
