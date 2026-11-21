'use client';
import { createContext, useContext } from 'react';

/** Public pages (share links, the demo) render boards without any write controls. */
const ReadOnly = createContext(false);
export const ReadOnlyProvider = ({ children }: { children: React.ReactNode }) => <ReadOnly.Provider value>{children}</ReadOnly.Provider>;
export const useReadOnly = () => useContext(ReadOnly);
