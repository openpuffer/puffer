import React from 'react';
import ConfigEditor from '../components/ConfigEditor';

const ConfigPage: React.FC = () => {
  return (
    <div className="h-full overflow-y-auto px-6 py-6">
      <header className="mb-4">
        <h1 className="font-mono text-lg font-bold uppercase tracking-widest text-slate-100">
          Configuration
        </h1>
        <p className="font-mono text-[11px] uppercase tracking-wider text-slate-500">
          Operating mode · layers · alerts
        </p>
      </header>
      <ConfigEditor />
    </div>
  );
};

export default ConfigPage;
