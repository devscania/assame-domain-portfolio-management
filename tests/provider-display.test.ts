import { describe, expect, it } from 'vitest';
import { providerIdForName as providerFromLabel } from '../src/integrations/catalog';
describe('known provider display names', () => {
  it('resolves supported labels and explicit registrar variants', () => {
    expect(providerFromLabel('GoDaddy')).toBe('godaddy');
    expect(providerFromLabel('SellerHub')).toBe('spaceship');
    expect(providerFromLabel('Atom Registrar')).toBe('atomRegistrar');
    expect(providerFromLabel('Namecheap')).toBe('namecheap');
  });
  it('leaves unknown registrar text unclassified', () => {
    expect(providerFromLabel('Unknown registrar')).toBeUndefined();
    expect(providerFromLabel('constructor')).toBeUndefined();
    expect(providerFromLabel('')).toBeUndefined();
  });
});
