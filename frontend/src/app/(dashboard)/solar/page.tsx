'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  Sun,
  Settings2,
  MessageCircle,
  Calculator,
  Database,
  Send,
  Zap,
  FileText,
  MapPin,
  IndianRupee,
  Workflow,
} from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { SolarConfigPanel } from '@/components/settings/solar-config';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useTranslations } from 'next-intl';

type Tab = 'how' | 'setup';

function Step({
  n,
  icon: Icon,
  title,
  body,
}: {
  n: number;
  icon: typeof Sun;
  title: string;
  body: string;
}) {
  return (
    <div className="flex gap-4">
      <div className="flex flex-col items-center">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
          {n}
        </div>
        <div className="mt-1 w-px flex-1 bg-border" />
      </div>
      <div className="pb-8">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        </div>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{body}</p>
      </div>
    </div>
  );
}

export default function SolarAssistantPage() {
  const t = useTranslations('SolarPage');
  const [tab, setTab] = useState<Tab>('how');

  return (
    <div>
      <div className="flex items-center gap-2">
        <Sun className="h-6 w-6 text-primary" />
        <h1 className="text-2xl font-bold tracking-tight text-foreground">
          {t('title')}
        </h1>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">{t('subtitle')}</p>
      <Link
        href="/flows"
        className={cn(buttonVariants(), 'mt-4 inline-flex')}
      >
        <Workflow className="mr-2 h-4 w-4" />
        Flows — Solar Assistant template
      </Link>

      <Tabs
        value={tab}
        onValueChange={(v) => setTab(v as Tab)}
        className="mt-6"
      >
        <TabsList>
          <TabsTrigger value="how">
            <Zap className="mr-1.5 h-4 w-4" /> {t('howTab')}
          </TabsTrigger>
          <TabsTrigger value="setup">
            <Settings2 className="mr-1.5 h-4 w-4" /> {t('setupTab')}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="how" className="mt-4 space-y-5">
          <Card>
            <CardHeader>
              <CardTitle className="text-foreground">{t('flowTitle')}</CardTitle>
              <CardDescription>{t('flowDesc')}</CardDescription>
            </CardHeader>
            <CardContent className="pt-2">
              <Step n={1} icon={MessageCircle} title={t('s1Title')} body={t('s1Body')} />
              <Step n={2} icon={FileText} title={t('s2Title')} body={t('s2Body')} />
              <Step n={3} icon={Database} title={t('s3Title')} body={t('s3Body')} />
              <Step n={4} icon={Calculator} title={t('s4Title')} body={t('s4Body')} />
              <Step n={5} icon={Send} title={t('s5Title')} body={t('s5Body')} />
              <div className="flex gap-4">
                <div className="flex flex-col items-center">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">
                    6
                  </div>
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <IndianRupee className="h-4 w-4 text-primary" />
                    <h3 className="text-sm font-semibold text-foreground">{t('s6Title')}</h3>
                  </div>
                  <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                    {t('s6Body')}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-4 sm:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base text-foreground">
                  <MessageCircle className="h-4 w-4 text-primary" />
                  {t('triggersTitle')}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 text-sm text-muted-foreground">
                  <li>{t('trigger1')}</li>
                  <li>{t('trigger2')}</li>
                  <li>{t('trigger3')}</li>
                  <li>{t('trigger4')}</li>
                </ul>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base text-foreground">
                  <MapPin className="h-4 w-4 text-primary" />
                  {t('needsTitle')}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 text-sm text-muted-foreground">
                  <li>{t('need1')}</li>
                  <li>{t('need2')}</li>
                  <li>{t('need3')}</li>
                </ul>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base text-foreground">{t('exampleTitle')}</CardTitle>
              <CardDescription>{t('exampleDesc')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="rounded-lg border border-border bg-muted/40 p-3">
                <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  {t('customer')}
                </p>
                <p className="mt-1 text-sm text-foreground">{t('exCustomer')}</p>
              </div>
              <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
                <p className="text-[11px] font-medium uppercase tracking-wider text-primary">
                  {t('bot')}
                </p>
                <p className="mt-1 whitespace-pre-line text-sm text-foreground">{t('exBot')}</p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="setup" className="mt-4">
          <SolarConfigPanel hideHead />
        </TabsContent>
      </Tabs>
    </div>
  );
}
