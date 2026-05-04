import React from 'react';
import { FlaskConical } from 'lucide-react';

const TestsPage: React.FC = () => {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 px-6 py-6">
      <FlaskConical className="h-10 w-10 text-amber-300/70" />
      <h1 className="font-mono text-lg font-bold uppercase tracking-widest text-slate-100">
        Tests
      </h1>
      <p className="max-w-md text-center font-mono text-[11px] uppercase tracking-wider text-slate-500">
        Adversarial test runner · coming soon
      </p>
      <p className="mt-2 max-w-lg text-center font-mono text-[10px] leading-relaxed text-slate-600">
        This page will surface the existing adversarial suite (PII bypass, MCP bypass, network
        bypass, filesystem bypass, prompt injection) with one-click runs against the live daemon
        and pass/fail history.
      </p>
    </div>
  );
};

export default TestsPage;
