'use client';
import { useState } from 'react';

import Topbar from '../components/Topbar';
import WorkspaceLayout from '../components/WorkspaceLayout';

export default function HomePage() {
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(false);
  return <main className="relative isolate grid h-screen max-h-screen grid-rows-[34px_minmax(0,1fr)] min-w-[320px] min-h-0 overflow-hidden bg-transparent text-(--codeclub-text) font-sans">
      <Topbar leftOpen={leftOpen} rightOpen={rightOpen} onToggleLeft={() => setLeftOpen((open) => !open)} onToggleRight={() => setRightOpen((open) => !open)} />
      <WorkspaceLayout leftOpen={leftOpen} rightOpen={rightOpen} />
  </main>;
}
