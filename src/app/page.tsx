import TeaRoomShell from '../ui/TeaRoomShell';
import { getCurrentUser } from '../auth/current-user';

/**
 * Entry: full 3D Bitget Thesis Desk (not a flat dashboard).
 * Matches reference architecture: https://iroh-tea-shop.up.railway.app
 */
export default async function Page() {
  const user = await getCurrentUser();
  return <TeaRoomShell key={user?.id ?? 'guest'} user={user} />;
}
