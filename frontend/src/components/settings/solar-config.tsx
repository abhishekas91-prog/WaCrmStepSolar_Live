'use client';

import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Search, Sun } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { canEditSettings } from '@/lib/auth/roles';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from '@/components/ui/card';
import { SettingsPanelHead } from './settings-panel-head';
import { useTranslations } from 'next-intl';
import type { SolarConfig, StateSubsidyOverride } from '@/lib/solar/types';
import { DEFAULT_SOLAR_CONFIG } from '@/lib/solar/data';
import { buildRecommendation } from '@/lib/solar/recommend';
import { formatQuote, formatSizingOnly } from '@/lib/solar/format';

interface SolarConfigResponse {
  config: {
    enabled: boolean;
    auto_reply_enabled: boolean;
    price_per_kw: number;
    tariff_per_unit: number;
    generation_factor: number;
    gst_rate: number;
    grid_tariff: number;
    subsidy_overrides: Record<string, StateSubsidyOverride>;
    process_steps: string[];
    company_name: string;
  };
  states: string[];
  builtin_subsidy: Record<string, StateSubsidyOverride>;
}

/** Turn the edited form state into the `SolarConfig` the engine expects. */
function toEngineConfig(form: {
  enabled: boolean;
  autoReply: boolean;
  companyName: string;
  pricePerKw: string;
  gstRate: string;
  gridTariff: string;
  tariffPerUnit: string;
  generationFactor: string;
  subsidyOverrides: Record<string, StateSubsidyOverride>;
  processSteps: string;
}): SolarConfig {
  const num = (v: string, fb: number) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : fb;
  };
  return {
    enabled: form.enabled,
    autoReplyEnabled: form.autoReply,
    companyName: form.companyName.trim() || DEFAULT_SOLAR_CONFIG.companyName,
    pricePerKw: num(form.pricePerKw, DEFAULT_SOLAR_CONFIG.pricePerKw),
    gstRate: num(form.gstRate, DEFAULT_SOLAR_CONFIG.gstRate),
    gridTariff: num(form.gridTariff, DEFAULT_SOLAR_CONFIG.gridTariff),
    tariffPerUnit: num(form.tariffPerUnit, DEFAULT_SOLAR_CONFIG.tariffPerUnit),
    generationFactorPerKwPerDay: num(
      form.generationFactor,
      DEFAULT_SOLAR_CONFIG.generationFactorPerKwPerDay,
    ),
    subsidyOverrides: form.subsidyOverrides,
    processSteps: form.processSteps
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean),
  };
}

export function SolarConfigPanel({ hideHead = false }: { hideHead?: boolean }) {
  const { accountRole } = useAuth();
  const canEdit = accountRole ? canEditSettings(accountRole) : false;
  const t = useTranslations('Settings.solar');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [enabled, setEnabled] = useState(DEFAULT_SOLAR_CONFIG.enabled);
  const [autoReply, setAutoReply] = useState(DEFAULT_SOLAR_CONFIG.autoReplyEnabled);
  const [companyName, setCompanyName] = useState(DEFAULT_SOLAR_CONFIG.companyName);
  const [pricePerKw, setPricePerKw] = useState(String(DEFAULT_SOLAR_CONFIG.pricePerKw));
  const [gstRate, setGstRate] = useState(String(DEFAULT_SOLAR_CONFIG.gstRate));
  const [gridTariff, setGridTariff] = useState(String(DEFAULT_SOLAR_CONFIG.gridTariff));
  const [tariffPerUnit, setTariffPerUnit] = useState(String(DEFAULT_SOLAR_CONFIG.tariffPerUnit));
  const [generationFactor, setGenerationFactor] = useState(
    String(DEFAULT_SOLAR_CONFIG.generationFactorPerKwPerDay),
  );
  const [subsidyOverrides, setSubsidyOverrides] = useState<
    Record<string, StateSubsidyOverride>
  >({});
  const [processSteps, setProcessSteps] = useState(
    DEFAULT_SOLAR_CONFIG.processSteps.join('\n'),
  );

  const [states, setStates] = useState<string[]>([]);
  const [search, setSearch] = useState('');

  // Live preview inputs
  const [sampleBill, setSampleBill] = useState('2500');
  const [sampleState, setSampleState] = useState('Uttar Pradesh');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/solar/config');
        const data = (await res.json()) as SolarConfigResponse;
        if (!res.ok) {
          toast.error((data as { error?: string }).error ?? t('loadFailed'));
          return;
        }
        if (cancelled) return;
        const c = data.config;
        setEnabled(c.enabled);
        setAutoReply(c.auto_reply_enabled);
        setCompanyName(c.company_name);
        setPricePerKw(String(c.price_per_kw));
        setGstRate(String(c.gst_rate));
        setGridTariff(String(c.grid_tariff));
        setTariffPerUnit(String(c.tariff_per_unit));
        setGenerationFactor(String(c.generation_factor));
        setSubsidyOverrides(c.subsidy_overrides ?? {});
        setProcessSteps((c.process_steps ?? []).join('\n'));
        setStates(data.states ?? []);
        if (data.states?.length && !data.states.includes(sampleState)) {
          setSampleState(data.states[0]);
        }
      } catch {
        toast.error(t('loadFailed'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Mount-once loader; `sampleState` is a lazy UI default, not a dep.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t]);

  const filteredStates = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return states;
    return states.filter((s) => s.toLowerCase().includes(q));
  }, [states, search]);

  const engineConfig = toEngineConfig({
    enabled,
    autoReply,
    companyName,
    pricePerKw,
    gstRate,
    gridTariff,
    tariffPerUnit,
    generationFactor,
    subsidyOverrides,
    processSteps,
  });

  // Deterministic preview — same math the bot runs.
  const preview = useMemo(() => {
    const bill = Number(sampleBill);
    if (!Number.isFinite(bill) || bill <= 0) return null;
    const result = buildRecommendation({
      customerMessages: [`mera bill ${bill} hai`],
      profile: { state: sampleState || null } as never,
      config: engineConfig,
    });
    if (!result.recommendation) return null;
    return result.needsState
      ? formatSizingOnly(result.recommendation, engineConfig)
      : formatQuote(result.recommendation, engineConfig);
  }, [engineConfig, sampleBill, sampleState]);

  async function handleSave() {
    setSaving(true);
    try {
      const res = await fetch('/api/solar/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled,
          auto_reply_enabled: autoReply,
          company_name: companyName,
          price_per_kw: Number(pricePerKw) || 0,
          gst_rate: Number(gstRate) || 0,
          grid_tariff: Number(gridTariff) || 0,
          tariff_per_unit: Number(tariffPerUnit) || 0,
          generation_factor: Number(generationFactor) || 0,
          subsidy_overrides: subsidyOverrides,
          process_steps: engineConfig.processSteps,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(data?.error ?? t('saveFailed'));
        return;
      }
      toast.success(t('saveSuccess'));
    } catch {
      toast.error(t('saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        {t('loadFailed') && 'Loading…'}
      </div>
    );
  }

  const disabled = !canEdit;

  return (
    <div className="max-w-3xl space-y-5">
      {!hideHead && (
        <SettingsPanelHead title={t('title')} description={t('description')} />
      )}

      {/* General */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-foreground">
            <Sun className="size-4 text-primary" />
            {t('general')}
          </CardTitle>
          <CardDescription className="text-muted-foreground">
            {t('generalDesc')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
            <div>
              <p className="text-sm font-medium text-foreground">{t('enabled')}</p>
              <p className="text-xs text-muted-foreground">{t('enabledDesc')}</p>
            </div>
            <Switch checked={enabled} onCheckedChange={setEnabled} disabled={disabled} />
          </div>

          <div className="flex items-center justify-between gap-4 rounded-md border border-border p-3">
            <div>
              <p className="text-sm font-medium text-foreground">{t('autoReply')}</p>
              <p className="text-xs text-muted-foreground">{t('autoReplyDesc')}</p>
            </div>
            <Switch
              checked={autoReply}
              onCheckedChange={setAutoReply}
              disabled={disabled || !enabled}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="solar-company">{t('companyName')}</Label>
            <Input
              id="solar-company"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder={t('companyNamePlaceholder')}
              disabled={disabled}
            />
          </div>
        </CardContent>
      </Card>

      {/* Pricing */}
      <Card>
        <CardHeader>
          <CardTitle className="text-foreground">{t('pricing')}</CardTitle>
          <CardDescription className="text-muted-foreground">
            {t('pricingDesc')}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="solar-price">{t('pricePerKw')}</Label>
            <Input
              id="solar-price"
              type="number"
              min={0}
              value={pricePerKw}
              onChange={(e) => setPricePerKw(e.target.value)}
              disabled={disabled}
            />
            <p className="text-xs text-muted-foreground">{t('pricePerKwHint')}</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="solar-gst">{t('gstRate')}</Label>
            <Input
              id="solar-gst"
              type="number"
              min={0}
              step={0.1}
              value={gstRate}
              onChange={(e) => setGstRate(e.target.value)}
              disabled={disabled}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="solar-grid-tariff">{t('gridTariff')}</Label>
            <Input
              id="solar-grid-tariff"
              type="number"
              min={0}
              step={0.1}
              value={gridTariff}
              onChange={(e) => setGridTariff(e.target.value)}
              disabled={disabled}
            />
            <p className="text-xs text-muted-foreground">{t('gridTariffHint')}</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="solar-tariff-unit">{t('tariffPerUnit')}</Label>
            <Input
              id="solar-tariff-unit"
              type="number"
              min={0}
              step={0.1}
              value={tariffPerUnit}
              onChange={(e) => setTariffPerUnit(e.target.value)}
              disabled={disabled}
            />
            <p className="text-xs text-muted-foreground">{t('tariffPerUnitHint')}</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="solar-generation">{t('generationFactor')}</Label>
            <Input
              id="solar-generation"
              type="number"
              min={0}
              step={0.1}
              value={generationFactor}
              onChange={(e) => setGenerationFactor(e.target.value)}
              disabled={disabled}
            />
            <p className="text-xs text-muted-foreground">{t('generationFactorHint')}</p>
          </div>
        </CardContent>
      </Card>

      {/* Subsidy overrides */}
      <Card>
        <CardHeader>
          <CardTitle className="text-foreground">{t('subsidy')}</CardTitle>
          <CardDescription className="text-muted-foreground">
            {t('subsidyDesc')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t('searchStates')}
              className="pl-9"
              disabled={disabled}
            />
          </div>
          <div className="max-h-72 space-y-2 overflow-y-auto rounded-md border border-border p-3">
            {filteredStates.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                {t('noStates')}
              </p>
            ) : (
              filteredStates.map((state) => {
                const override = subsidyOverrides[state] ?? { topUp: 0 };
                return (
                  <div
                    key={state}
                    className="flex items-center justify-between gap-3 rounded-md px-1 py-1.5"
                  >
                    <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                      {state}
                    </span>
                    <div className="flex w-40 items-center gap-1">
                      <span className="text-xs text-muted-foreground">{t('topUp')}</span>
                      <Input
                        type="number"
                        min={0}
                        value={override.topUp}
                        onChange={(e) =>
                          setSubsidyOverrides((prev) => ({
                            ...prev,
                            [state]: { topUp: Number(e.target.value) || 0 },
                          }))
                        }
                        className="h-8"
                        disabled={disabled}
                      />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </CardContent>
      </Card>

      {/* Process steps */}
      <Card>
        <CardHeader>
          <CardTitle className="text-foreground">{t('process')}</CardTitle>
          <CardDescription className="text-muted-foreground">
            {t('processDesc')}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Textarea
            value={processSteps}
            onChange={(e) => setProcessSteps(e.target.value)}
            rows={6}
            disabled={disabled}
          />
        </CardContent>
      </Card>

      {/* Live preview */}
      <Card>
        <CardHeader>
          <CardTitle className="text-foreground">{t('preview')}</CardTitle>
          <CardDescription className="text-muted-foreground">
            {t('previewDesc')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="solar-sample-bill">{t('sampleBill')}</Label>
              <Input
                id="solar-sample-bill"
                type="number"
                min={0}
                value={sampleBill}
                onChange={(e) => setSampleBill(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="solar-sample-state">{t('sampleState')}</Label>
              <select
                id="solar-sample-state"
                value={sampleState}
                onChange={(e) => setSampleState(e.target.value)}
                className="h-9 w-full rounded-lg border border-border bg-muted px-2.5 text-sm text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
              >
                {states.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <pre className="max-h-80 overflow-auto rounded-md bg-muted p-4 text-xs leading-relaxed whitespace-pre-wrap text-foreground">
            {preview ?? t('previewEmpty')}
          </pre>
        </CardContent>
      </Card>

      <div className="flex items-center justify-between">
        {!canEdit ? <p className="text-xs text-muted-foreground">{t('adminOnlyHint')}</p> : <span />}
        <Button onClick={handleSave} disabled={disabled || saving}>
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          {t('save')}
        </Button>
      </div>
    </div>
  );
}
