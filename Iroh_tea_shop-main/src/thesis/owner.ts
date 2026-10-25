import 'server-only';
import type { PrismaClient } from '@prisma/client';
import { userFromRequest } from '../iroh/request-user';

export const GUEST_COOKIE = 'iroh_guest';
const GUEST_MAX_AGE = 365 * 24 * 60 * 60;
const GUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface Owner {
  /** "u:<userId>" for a signed-in person, "g:<guestId>" for a guest. */
  key: string;
  signedIn: boolean;
  /** Set on a guest's first request so the cookie can be written to the response. */
  newGuestId: string | null;
}

function cookieValue(request: Request, name: string): string | undefined {
  return request.headers
    .get('cookie')
    ?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

/** Who is asking: the signed-in user, else the guest cookie, else a fresh guest. */
export async function resolveOwner(
  db: PrismaClient,
  request: Request,
): Promise<Owner> {
  const user = await userFromRequest(db, request);
  if (user) return { key: `u:${user.id}`, signedIn: true, newGuestId: null };
  const guest = cookieValue(request, GUEST_COOKIE);
  if (guest && GUEST_ID.test(guest))
    return { key: `g:${guest.toLowerCase()}`, signedIn: false, newGuestId: null };
  const fresh = crypto.randomUUID();
  return { key: `g:${fresh}`, signedIn: false, newGuestId: fresh };
}

/** Attach the guest cookie to a response when this request created the guest. */
export function withOwnerCookie(response: Response, owner: Owner): Response {
  if (owner.newGuestId) {
    const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
    response.headers.append(
      'set-cookie',
      `${GUEST_COOKIE}=${owner.newGuestId}; Path=/; Max-Age=${GUEST_MAX_AGE}; HttpOnly; SameSite=Lax${secure}`,
    );
  }
  return response;
}
