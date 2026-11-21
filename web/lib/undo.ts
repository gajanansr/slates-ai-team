/** Ask the app to offer "Undo" for something that just happened. Shown by <UndoToast/> in the app shell. */
export type UndoRequest = { label: string; undo: { type: 'version'; slug: string } | { type: 'unarchive'; slug: string } };
export const UNDO_EVENT = 'slates:undo';

export function offerUndo(req: UndoRequest) {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent<UndoRequest>(UNDO_EVENT, { detail: req }));
}
