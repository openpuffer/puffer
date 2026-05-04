import React from 'react';
import { Lightbulb } from 'lucide-react';

const RecommendationsPage: React.FC = () => {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 py-6">
      <Lightbulb className="h-10 w-10 text-amber-300/70" />
      <h1 className="font-mono text-lg font-bold uppercase tracking-widest text-slate-100">
        Recommendations
      </h1>
      <p className="max-w-md text-center font-mono text-[11px] uppercase tracking-wider text-slate-500">
        AI-driven hardening suggestions · coming soon
      </p>
      <p className="mt-2 max-w-lg text-center font-mono text-[10px] leading-relaxed text-slate-600">
        Will analyze recent audit data, layer activations, score history and surface concrete
        suggestions: missing rules, unsafe defaults, top offending agents, MCP tools to lock down.
      </p>
    </div>
  );
};

export default RecommendationsPage;
