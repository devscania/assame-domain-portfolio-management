import { describe, expect, it } from 'vitest';
import { domainTableQuery, domainTableSearch } from '../src/lib/domain-table-query';
describe('domain table URL filters', () => {
  it('round trips navigation and refresh state without dropping scope or pagination', () => {
    const state = domainTableQuery(
      new URLSearchParams(
        'q=example&tld=com&status=all&registrar=Namecheap&tag=Priority&page=3&take=100&sort=expiration&direction=desc&comparison=stale&listing=none&attention=price-mismatch&expiration=upcoming&days=30&month=2027-01',
      ),
      true,
    );
    expect(domainTableQuery(new URLSearchParams(domainTableSearch(state)), true)).toEqual(state);
    expect(state.page).toBe(3);
    expect(state.attention).toBe('price-mismatch');
    expect(state.listing).toBe('none');
  });
  it('bounds query values and preserves active matrix defaults', () => {
    const state = domainTableQuery(
      new URLSearchParams(
        'page=-1&take=999999&sort=unknown&comparison=constructor&days=9999&attention=unknown',
      ),
      true,
    );
    expect(state).toMatchObject({
      page: 1,
      take: 25,
      sort: 'comparison',
      days: '365',
      attention: '',
      status: 'active',
    });
    expect(state.comparison).toBe('');
    expect(domainTableQuery(new URLSearchParams('take=200')).take).toBe(200);
  });
});
