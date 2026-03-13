import React, { useState, useEffect } from 'react';
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Save, Settings, Shield, Layers, Radar, BarChart3 } from 'lucide-react';

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
        <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-200">
          <Settings className="h-5 w-5" />
          Configuration
        </h2>
        <div className="flex items-center gap-3">
          {saveStatus === 'success' && (
            <span className="text-sm text-puffer-green">Saved successfully</span>
          )}
          {saveStatus === 'error' && (
            <span className="text-sm text-puffer-red">{error}</span>
          )}
          <Button onClick={handleSave} disabled={saving}>
            <Save className="h-4 w-4" />
            {saving ? 'Saving...' : 'Save Changes'}
          </Button>
        </div>
      </div>

      <Separator />

      {/* Operating Mode */}
      <Card className="border-slate-700/50 bg-slate-800/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm uppercase tracking-wider text-slate-400">
            <Shield className="h-4 w-4" />
            Operating Mode
          </CardTitle>
          <CardDescription>
            {config.mode === 'monitor' && 'Observe only — logs threats but never blocks'}
            {config.mode === 'enforce' && 'Active protection — blocks detected threats'}
            {config.mode === 'paranoid' && 'Maximum security — whitelist-only, all layers at max sensitivity'}
            {config.mode === 'interactive' && 'Ask before blocking — escalates all blocks for user confirmation'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            {MODES.map((mode) => (
              <Button
                key={mode}
                variant={config.mode === mode ? 'default' : 'secondary'}
                size="sm"
                onClick={() => setMode(mode)}
              >
                {mode.charAt(0).toUpperCase() + mode.slice(1)}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Separator />

      {/* Defense Layers */}
      <Card className="border-slate-700/50 bg-slate-800/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm uppercase tracking-wider text-slate-400">
            <Layers className="h-4 w-4" />
            Defense Layers
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {Object.entries(LAYER_NAMES).map(([key, name]) => {
              const layer = config.layers[key];
              if (!layer) return null;
              const layerNumber = Object.keys(LAYER_NAMES).indexOf(key) + 1;
              return (
                <div
                  key={key}
                  className="flex items-center justify-between rounded-lg bg-slate-900/50 px-4 py-3"
                >
                  <div className="flex items-center gap-3">
                    <Badge variant="outline" className="font-mono text-xs">
                      L{layerNumber}
                    </Badge>
                    <span className="text-sm text-slate-200">{name}</span>
                  </div>
                  <Switch
                    checked={layer.enabled}
                    onCheckedChange={() => toggleLayer(key)}
                  />
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Separator />

      {/* Auto-Discovery */}
      <Card className="border-slate-700/50 bg-slate-800/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm uppercase tracking-wider text-slate-400">
            <Radar className="h-4 w-4" />
            Auto-Discovery
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-300">Enabled</span>
              <Switch
                checked={config.autoDiscovery.enabled}
                onCheckedChange={() =>
                  setConfig({
                    ...config,
                    autoDiscovery: {
                      ...config.autoDiscovery,
                      enabled: !config.autoDiscovery.enabled,
                    },
                  })
                }
              />
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
                <Switch
                  checked={!!(config.autoDiscovery as Record<string, unknown>)[scanner]}
                  onCheckedChange={() =>
                    setConfig({
                      ...config,
                      autoDiscovery: {
                        ...config.autoDiscovery,
                        [scanner]: !(config.autoDiscovery as Record<string, unknown>)[scanner],
                      },
                    })
                  }
                />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Separator />

      {/* Dashboard & Audit */}
      <div className="grid grid-cols-2 gap-4">
        <Card className="border-slate-700/50 bg-slate-800/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm uppercase tracking-wider text-slate-400">
              <BarChart3 className="h-4 w-4" />
              Dashboard
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 text-sm text-slate-300">
              <div className="flex justify-between">
                <span>Port</span>
                <span className="text-slate-400">{config.dashboard.port}</span>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card className="border-slate-700/50 bg-slate-800/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm uppercase tracking-wider text-slate-400">
              <Shield className="h-4 w-4" />
              Audit
            </CardTitle>
          </CardHeader>
          <CardContent>
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
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default ConfigEditor;
