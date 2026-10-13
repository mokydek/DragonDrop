// Which parts of the admin panel an admin sees. The main admin sees everything; for the other
// admins the main admin can switch sections off (setting `admin_hidden`).

export const ADMIN_SECTIONS = [
  'overview',
  'deposits_brainrots',
  'deposits_stars',
  'withdrawals',
  'cases',
  'items',
  'users',
  'referrals',
  'promos',
  'settings',
  'broadcast',
];

/** The section a deposit / withdrawal request belongs to. */
export const requestSection = (r) => (r.kind === 'withdraw' ? 'withdrawals' : r.method === 'stars' ? 'deposits_stars' : 'deposits_brainrots');

export function createAccess({ settings, users }) {
  /** The main admin (everyone, when no main admin is configured). */
  const isMain = (id) => users.isOwnerId(id) || !users.hasOwner();
  const hidden = () => settings.get('admin_hidden') || [];
  /** Can this admin see the section? */
  const can = (id, section) => isMain(id) || !hidden().includes(section);
  /** The sections this admin sees. */
  const sections = (id) => ADMIN_SECTIONS.filter((s) => can(id, s));
  return { isMain, can, sections };
}
