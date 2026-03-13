import React, { useState, useEffect } from 'react';

interface LayerConfig {
  enabled: boolean;
  [key: string]: unknown;
}

interface Config {
  mode: string;
  layers: Record<string, LayerConfig>;
  dashboard: { enabled: boolean; port: number };
  audit: { logPath: string; retentionDays: number };
  alerts: { desktop: boolean; webhook?: string };
  autoDiscovery: {
    enabled: boolean;
    scanIntervalMs: number;
    processScanner: boolean;
    portScanner: boolean;
    networkScanner: boolean;
  };
}

const MODES = ['monitor', 'enforce', 'paranoid', 'interactive'] as const;

const LAYER_NAMES: Record<string, string> = {
  pii: 'PII Scanner',
  injection: 'Injection Detector',
  commands: 'Command Analyzer',
  network: 'Network Egress Guard',
  filesystem: 'Filesystem Sentinel',
  behavior: 'Behavior Analyzer',
  mcp: 'MCP Detector',
};

const ConfigEditor: React.FC = () => {
  const [config, setConfig] = useState<Config | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'success' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/config')
      .then((res) => res.json())
      .then((data) => {
        setConfig(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

  const handleSave = async () => {
    if (!config) return;
    setSaving(true);
    setSaveStatus('idle');
    try {
      const res = await fetch('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      if (res.ok) {
        setSaveStatus('success');
        setTimeout(() => setSaveStatus('idle'), 3000);
      } else {
        const data = await res.json();
        setSaveStatus('error');
        setError(data.error);
      }
    } catch (err) {
      setSaveStatus('error');
      setError((err as Error).message);
    }
    setSaving(false);
  };

  const toggleLayer = (layerName: string) => {
    if (!config) return;
    setConfig({
      ...config,
      layers: {
        ...config.layers,
        [layerName]: {
          ...config.layers[layerName],
          enabled: !config.layers[layerName].enabled,
        },
      },
    });
  };

  const setMode = (mode: string) => {
    if (!config) return;
    setConfig({ ...config, mode });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <span className="text-slate-400">Loading configuration...</span>
      </div>
    );
  }

  if (error && !config) {
    return (
      <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4">
        <span className="text-red-400">Failed to load config: {error}</span>
      </div>
    );
  }

  if (!config) return null;

  return (
    <div className="space-y-6">
      {/* Save bar */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-200">Configuration</h2>
        <div className="flex items-center gap-3">
          {saveStatus === 'success' && (
            <span className="text-sm text-puffer-green">Saved successfully</span>
          )}
          {saveStatus === 'error' && (
            <span className="text-sm text-puffer-red">{error}</span>
          )}
          <button
            onClick={handleSave}
            disabled={saving}
            className="rounded-lg bg-puffer-blue px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-puffer-blue/80 disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>

      {/* Operating Mode */}
      <div className="rounded-lg border border-slate-700/50 bg-slate-800/50 p-5">
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">
          Operating Mode
        </h3>
        <div className="flex gap-2">
          {MODES.map((mode) => (
            <button
              key={mode}
              onClick={() => setMode(mode)}
              className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                config.mode === mode
                  ? 'bg-puffer-blue text-white'
                  : 'bg-slate-700/50 text-slate-300 hover:bg-slate-700'
              }`}
            >
              {mode.charAt(0).toUpperCase() + mode.slice(1)}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-slate-500">
          {config.mode === 'monitor' && 'Observe only — logs threats but never blocks'}
          {config.mode === 'enforce' && 'Active protection — blocks detected threats'}
          {config.mode === 'paranoid' && 'Maximum security — whitelist-only, all layers at max sensitivity'}
          {config.mode === 'interactive' && 'Ask before blocking — escalates all blocks for user confirmation'}
        </p>
      </div>

      {/* Defense Layers */}
      <div className="rounded-lg border border-slate-700/50 bg-slate-800/50 p-5">
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">
          Defense Layers
        </h3>
        <div className="space-y-2">
          {Object.entries(LAYER_NAMES).map(([key, name]) => {
            const layer = config.layers[key];
            if (!layer) return null;
            return (
              <div
                key={key}
                className="flex items-center justify-between rounded-lg bg-slate-900/50 px-4 py-3"
              >
                <div className="flex items-center gap-3">
                  <span className="w-6 text-center text-xs font-bold text-slate-500">
                    L{Object.keys(LAYER_NAMES).indexOf(key) + 1}
                  </span>
                  <span className="text-sm text-slate-200">{name}</span>
                </div>
                <button
                  onClick={() => toggleLayer(key)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    layer.enabled ? 'bg-puffer-green' : 'bg-slate-600'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      layer.enabled ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Auto-Discovery */}
      <div className="rounded-lg border border-slate-700/50 bg-slate-800/50 p-5">
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">
          Auto-Discovery
        </h3>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-slate-300">Enabled</span>
            <button
              onClick={() =>
                setConfig({
                  ...config,
                  autoDiscovery: {
                    ...config.autoDiscovery,
                    enabled: !config.autoDiscovery.enabled,
                  },
                })
              }
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                config.autoDiscovery.enabled ? 'bg-puffer-green' : 'bg-slate-600'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  config.autoDiscovery.enabled ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-sm text-slate-300">Scan Interval</span>
            <span className="text-sm text-slate-400">
              {(config.autoDiscovery.scanIntervalMs / 1000).toFixed(0)}s
            </span>
          </div>
          {['processScanner', 'portScanner', 'networkScanner'].map((scanner) => (
            <div key={scanner} className="flex items-center justify-between">
              <span className="text-sm text-slate-300">
                {scanner.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase())}
              </span>
              <button
                onClick={() =>
                  setConfig({
                    ...config,
                    autoDiscovery: {
                      ...config.autoDiscovery,
                      [scanner]: !(config.autoDiscovery as Record<string, unknown>)[scanner],
                    },
                  })
                }
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  (config.autoDiscovery as Record<string, unknown>)[scanner]
                    ? 'bg-puffer-green'
                    : 'bg-slate-600'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    (config.autoDiscovery as Record<string, unknown>)[scanner]
                      ? 'translate-x-6'
                      : 'translate-x-1'
                  }`}
                />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Dashboard & Audit */}
      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-lg border border-slate-700/50 bg-slate-800/50 p-5">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">
            Dashboard
          </h3>
          <div className="space-y-2 text-sm text-slate-300">
            <div className="flex justify-between">
              <span>Port</span>
              <span className="text-slate-400">{config.dashboard.port}</span>
            </div>
          </div>
        </div>
        <div className="rounded-lg border border-slate-700/50 bg-slate-800/50 p-5">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-400">
            Audit
          </h3>
          <div className="space-y-2 text-sm text-slate-300">
            <div className="flex justify-between">
              <span>Retention</span>
              <span className="text-slate-400">{config.audit.retentionDays} days</span>
            </div>
            <div className="flex justify-between">
              <span>Desktop Alerts</span>
              <span className="text-slate-400">{config.alerts.desktop ? 'On' : 'Off'}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ConfigEditor;
