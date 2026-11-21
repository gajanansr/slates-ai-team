import { redirect } from 'next/navigation';

/** Today is generated now; there is nothing to arrange. */
export default function CustomizeHomeRedirect() {
  redirect('/settings/customize');
}
