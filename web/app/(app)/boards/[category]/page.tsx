import { redirect } from 'next/navigation';

/** Categories are spaces now. */
export default async function CategoryRedirect({ params }: { params: Promise<{ category: string }> }) {
  redirect(`/spaces/${(await params).category}`);
}
