import { Download, FolderGit2, Globe2, Sparkles } from 'lucide-react';

/** Public download page; installer and repository links are the only external destinations. */
const downloadUrl = 'https://github.com/Iangelone/Codeclub/releases/latest/download/Codeclub%20Setup.exe';
const repositoryUrl = 'https://github.com/Iangelone/Codeclub';

export const metadata = {
  title: 'Codeclub — An AI coding agent for Windows',
  description: 'Work with an AI coding agent across your project files, PowerShell, browser tabs, and Windows apps. Bring your own AI provider.',
};

const features = [
  { icon: Sparkles, title: 'An agent for real projects', text: 'Read and edit files, run PowerShell, and review the changes in your workspace.' },
  { icon: FolderGit2, title: 'Your choice of AI provider', text: 'Connect a supported provider and model. Codeclub does not lock you to one vendor.' },
  { icon: Globe2, title: 'Beyond the code editor', text: 'Inspect browser pages and use Windows desktop tools from the same workflow.' },
];

export default function LandingPage() {
  return (
    <main className="min-h-screen overflow-hidden bg-[#e4d6c0] text-[#171923]">
      <section id="top" className="relative flex min-h-[760px] items-center justify-center overflow-hidden bg-cover bg-center px-6 pb-24 pt-32 sm:min-h-screen" style={{ backgroundImage: "linear-gradient(180deg, rgba(255,248,236,0.18) 0%, rgba(242,224,198,0.08) 45%, rgba(45,31,27,0.3) 100%), url('/landing/Fondo.png')" }}>
        <div className="absolute inset-0 bg-gradient-to-b from-white/[0.08] via-transparent to-[#251b19]/20" />
        <nav className="absolute left-1/2 top-6 z-10 flex w-[calc(100%-32px)] max-w-[470px] -translate-x-1/2 items-center justify-between rounded-full border border-black/20 bg-[#25252b]/80 px-4 py-2.5 text-white shadow-[0_10px_30px_rgba(66,46,33,0.18)] backdrop-blur-md sm:top-8 sm:px-5">
          <a href="#top" className="flex items-center gap-2 text-[12px] font-semibold tracking-tight text-white"><img src="/logo.png" alt="Codeclub" className="h-5 w-5 rounded-md" /> Codeclub</a>
          <div className="flex items-center gap-4 text-[10px] font-medium text-white/70 sm:gap-5 sm:text-[11px]"><a href="#features" className="transition-colors hover:text-white">Features</a><a href={repositoryUrl} target="_blank" rel="noreferrer" className="transition-colors hover:text-white">GitHub</a><a href={downloadUrl} className="rounded-full bg-white px-3 py-1.5 text-[#24232b] transition-colors hover:bg-[#f6ead9]">Download</a></div>
        </nav>

        <div className="relative z-[1] mx-auto -mt-16 flex max-w-2xl flex-col items-center text-center sm:-mt-24">
          <span className="mb-5 rounded-full bg-[#28272c]/70 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-white shadow-sm backdrop-blur-sm">Independent project · Early beta</span>
          <h1 className="max-w-3xl font-serif text-5xl font-medium leading-[0.98] tracking-[-0.055em] text-[#1d1e27] sm:text-7xl">Your AI coding agent,<br />with access to Windows.</h1>
          <p className="mt-6 max-w-xl text-sm leading-6 text-[#25242b] sm:text-base">Work across your project files, PowerShell, browser tabs, and desktop apps from one local-first workspace. Connect the AI provider and model you choose.</p>
          <div className="mt-7 flex flex-wrap justify-center gap-3"><a href={downloadUrl} className="inline-flex h-10 items-center gap-2 rounded-full bg-white px-5 text-[12px] font-semibold text-[#25242b] shadow-[0_8px_20px_rgba(50,38,32,0.16)] transition-all hover:-translate-y-0.5 hover:bg-[#fffdf8]"><Download size={15} /> Download for Windows</a><a href={repositoryUrl} target="_blank" rel="noreferrer" className="inline-flex h-10 items-center rounded-full border border-[#25242b]/30 bg-white/40 px-5 text-[12px] font-semibold text-[#25242b] transition-colors hover:bg-white/70">View on GitHub</a></div>
          <p className="mt-4 max-w-xl text-[11px] leading-5 text-[#25242b]/80">Free for personal and other qualifying uses under the dual license. AI provider usage may cost extra. <a className="underline underline-offset-2" href={`${repositoryUrl}/blob/main/LICENSE.md`}>License details</a></p>
        </div>

      </section>

      <section id="features" className="bg-[#000000] px-6 py-24 text-[#FFFFFF] sm:py-32"><div className="mx-auto max-w-5xl"><div className="max-w-2xl"><p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[#FFFFFF]">Codeclub workspace</p><h2 className="mt-5 font-serif text-4xl font-medium leading-[1.02] tracking-[-0.055em] text-[#FFFFFF] sm:text-6xl">Everything you need to make an idea work.</h2></div><div className="mt-16 grid gap-0 border-t border-white/[0.16] md:grid-cols-3">{features.map(({ icon: Icon, title, text }, index) => <article key={title} className="border-b border-white/[0.16] py-8 md:border-b-0 md:border-r md:px-7 md:py-10 first:md:pl-0 last:md:border-r-0 last:md:pr-0"><div className="flex items-start justify-between"><Icon size={20} strokeWidth={1.6} className="text-[#FFFFFF]" /><span className="font-mono text-[10px] text-[#777777]">0{index + 1}</span></div><h3 className="mt-16 text-[16px] font-medium tracking-[-0.02em] text-[#FFFFFF]">{title}</h3><p className="mt-3 max-w-[220px] text-[13px] leading-6 text-[#999999]">{text}</p></article>)}</div></div></section>

      <section className="flex flex-col items-start justify-between gap-6 bg-[#000000] px-6 py-20 text-[#FFFFFF] sm:flex-row sm:items-center lg:px-[max(2rem,calc((100vw-1024px)/2))]"><div><h2 className="text-2xl font-semibold tracking-[-0.04em] text-[#FFFFFF]">Bring your project. Choose your model.</h2><p className="mt-2 text-sm text-[#999999]">Codeclub is free for qualifying uses. Your AI provider may charge separately.</p></div><a href={downloadUrl} className="inline-flex h-10 items-center gap-2 rounded-full bg-[#FFFFFF] px-4 text-[12px] font-semibold text-[#101820] transition-colors hover:bg-[#f4f4f4]"><Download size={15} /> Download for Windows</a></section>

      <footer className="flex items-center justify-between border-t border-white/[0.08] bg-[#000000] px-6 py-5 text-[11px] text-[#666666] lg:px-[max(2rem,calc((100vw-1024px)/2))]"><span>Codeclub · 2026</span><a href={repositoryUrl} target="_blank" rel="noreferrer" className="transition-colors hover:text-[#FFFFFF]">Open source on GitHub</a></footer>
    </main>
  );
}
