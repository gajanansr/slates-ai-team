import { redirect } from 'next/navigation';

/** The template gallery lives in the New board sheet on Boards. */
export default function NewBoard() {
  redirect('/boards?new=1');
}
