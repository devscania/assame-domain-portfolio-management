export const brand = {
  name: 'Assame',
  tagline: 'Every domain. One place.',
  description: 'Manage your entire domain portfolio across registrars and marketplaces from one powerful workspace.',
  get url() {
    return new URL(process.env.AUTH_URL || 'http://localhost:3010').origin;
  },
} as const;
