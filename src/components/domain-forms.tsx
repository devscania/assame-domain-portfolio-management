'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import Papa from 'papaparse';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowRight,
  Check,
  Download,
  FileSpreadsheet,
  Upload,
  AlertCircle,
  Trash2,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button, Field, Input, Modal, Badge } from './ui';
import { api, formatMoney, type DomainRow } from './client';
const schema = z.object({
  name: z.string().min(3),
  acquisitionCost: z.string().regex(/^\d+(\.\d{1,2})?$/),
  askingPrice: z.string(),
  registrar: z.string().min(1),
  currency: z.enum(['USD', 'EUR', 'GBP', 'CAD', 'AUD']),
  expiresAt: z.string(),
  acquiredAt: z.string(),
  renewalCost: z.string(),
  tags: z.string(),
});
type FormValues = z.infer<typeof schema>;
export function DomainForm({
  open,
  onOpenChange,
  domain,
}: {
  open: boolean;
  onOpenChange(value: boolean): void;
  domain?: DomainRow;
}) {
  const query = useQueryClient();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: domain?.name || '',
      acquisitionCost: domain?.acquisitionCost || '0',
      askingPrice: domain?.askingPrice || '',
      registrar:
        domain?.registrations.find((r) => r.registrar && r.registrar !== 'Unknown')?.registrar ||
        domain?.registrations[0]?.registrar ||
        'Unknown',
      currency: (domain?.currency as FormValues['currency']) || 'USD',
      expiresAt: domain?.registrations[0]?.expiresAt?.slice(0, 10) || '',
      acquiredAt: domain?.acquiredAt?.slice(0, 10) || '',
      renewalCost: domain?.registrations[0]?.renewalCost || '',
      tags: domain?.tags.map((t) => t.tag.name).join('; ') || '',
    },
  });
  return (
    <Modal
      title={domain ? 'Edit domain' : 'Add a domain'}
      description="Record an asset in your portfolio. Marketplace prices are managed separately."
      open={open}
      onOpenChange={onOpenChange}
    >
      <form
        method="post"
        className="stack"
        onSubmit={handleSubmit(async (values) => {
          setBusy(true);
          try {
            await api('domain.save', {
              id: domain?.id,
              values: {
                ...values,
                askingPrice: values.askingPrice || undefined,
                expiresAt: values.expiresAt || undefined,
                acquiredAt: values.acquiredAt || undefined,
                renewalCost: values.renewalCost || undefined,
                tags: values.tags
                  .split(';')
                  .map((t) => t.trim())
                  .filter(Boolean),
              },
            });
            await query.invalidateQueries();
            onOpenChange(false);
            toast.success(domain ? 'Domain updated' : 'Domain added');
          } catch (e) {
            toast.error((e as Error).message);
          } finally {
            setBusy(false);
          }
        })}
      >
        <Field label="Domain name">
          <Input {...register('name')} placeholder="your-next-idea.com" readOnly={!!domain} />
        </Field>
        <div className="form-grid">
          <Field label="Acquisition cost">
            <Input {...register('acquisitionCost')} inputMode="decimal" />
          </Field>
          <Field label="Internal asking price">
            <Input {...register('askingPrice')} inputMode="decimal" placeholder="Optional" />
          </Field>
          <Field label="Currency">
            <select {...register('currency')}>
              {['USD', 'EUR', 'GBP', 'CAD', 'AUD'].map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </Field>
          <Field label="Registrar">
            <Input {...register('registrar')} />
          </Field>
          <Field label="Acquired on">
            <Input type="date" {...register('acquiredAt')} />
          </Field>
          <Field label="Expiration date">
            <Input type="date" {...register('expiresAt')} />
          </Field>
          <Field label="Annual renewal cost">
            <Input {...register('renewalCost')} inputMode="decimal" placeholder="Optional" />
          </Field>
          <Field label="Tags" hint="Separate with semicolons">
            <Input {...register('tags')} placeholder="premium; short" />
          </Field>
        </div>
        {Object.entries(errors).map(([key, value]) => (
          <p className="error-text" key={key}>
            {key}: {value.message}
          </p>
        ))}
        <div className="dialog-actions">
          {domain && (
            <Button
              type="button"
              variant="danger"
              disabled={busy}
              onClick={async () => {
                if (
                  !confirm(
                    `Are you sure you want to delete ${domain.name}? This will remove it from your active portfolio.`,
                  )
                )
                  return;
                setBusy(true);
                try {
                  await api('domain.delete', { id: domain.id });
                  await query.invalidateQueries();
                  onOpenChange(false);
                  toast.success('Domain deleted');
                  router.push('/domains');
                } catch (e) {
                  toast.error((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <Trash2 size={14} />
              Delete domain
            </Button>
          )}
          <Button type="button" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save domain'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
type Preview = {
  inserts: number;
  updates: number;
  skipped: number;
  errors: { row: number; message: string }[];
  preview: { name: string; acquisitionCost: string; askingPrice?: string; currency: string }[];
  valid: number;
};
const fields = [
  { id: 'name', name: 'Domain name', aliases: ['domain', 'name', 'domainname'] },
  { id: 'registrar', name: 'Registrar', aliases: ['registrar'] },
  {
    id: 'acquisitionCost',
    name: 'Acquisition cost',
    aliases: ['acquisitioncost', 'cost', 'purchaseprice'],
  },
  { id: 'askingPrice', name: 'Internal asking price', aliases: ['askingprice', 'price', 'bin'] },
  {
    id: 'expiresAt',
    name: 'Expiration date (YYYY-MM-DD)',
    aliases: ['expiresat', 'expiry', 'expiration', 'expirationdate'],
  },
  { id: 'renewalCost', name: 'Renewal cost', aliases: ['renewalcost', 'renewal'] },
  { id: 'currency', name: 'Currency', aliases: ['currency'] },
  { id: 'acquiredAt', name: 'Acquired on', aliases: ['acquiredat', 'purchasedate'] },
  { id: 'tags', name: 'Tags (semicolon-separated)', aliases: ['tags'] },
];
export function ImportWizard({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange(value: boolean): void;
}) {
  const [step, setStep] = useState(0);
  const [csv, setCsv] = useState('');
  const [filename, setFilename] = useState('');
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [overwrite, setOverwrite] = useState(false);
  const [preview, setPreview] = useState<Preview>();
  const [busy, setBusy] = useState(false);
  const query = useQueryClient();
  async function load(file?: File) {
    if (!file) return;
    if (file.size > 10_000_000) return toast.error('Maximum file size is 10 MB');
    const text = await file.text();
    const parsed = Papa.parse(text, { header: true, preview: 3 });
    const columns = parsed.meta.fields || [];
    setCsv(text);
    setFilename(file.name);
    setHeaders(columns);
    const matches: Record<string, string> = {};
    for (const field of fields) {
      const detected = columns.find((h) =>
        field.aliases.includes(h.toLowerCase().replace(/[^a-z]/g, '')),
      );
      if (detected) matches[field.id] = detected;
    }
    setMapping(matches);
    setStep(1);
  }
  async function next() {
    setBusy(true);
    try {
      const result = await api<Preview>(step === 1 ? 'csv.preview' : 'csv.confirm', {
        csv,
        mapping: Object.fromEntries(Object.entries(mapping).filter(([, v]) => v)),
        overwrite,
      });
      setPreview(result);
      setStep(step + 1);
      if (step === 2) {
        await query.invalidateQueries();
        toast.success('Import completed');
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="Import your portfolio"
      description="From a spreadsheet to a single source of truth."
      wide
      open={open}
      onOpenChange={onOpenChange}
    >
      <div className="wizard-steps">
        {['Upload', 'Map columns', 'Review', 'Complete'].map((label, i) => (
          <div key={label} className={step >= i ? 'step-active' : ''}>
            <span>{step > i ? <Check size={13} /> : i + 1}</span>
            {label}
          </div>
        ))}
      </div>
      {step === 0 && (
        <>
          <label className="upload-zone">
            <span className="upload-icon">
              <Upload size={25} />
            </span>
            <strong>Bring your domains together</strong>
            <span>Choose a CSV file to get started</span>
            <small>Up to 10 MB · 10,000 rows · UTF-8</small>
            <input
              className="sr-only"
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => void load(e.target.files?.[0])}
            />
            <span className="btn btn-secondary">Choose file</span>
          </label>
          <a href="/sample-domains.csv" download className="template-link">
            <Download size={15} />
            Download sample CSV template
          </a>
          <p className="muted text-xs mt-4">
            This wizard imports domain assets and internal prices. It does not publish marketplace
            listings.
          </p>
        </>
      )}
      {step === 1 && (
        <div className="stack">
          <div className="file-chip">
            <FileSpreadsheet size={20} />
            <div>
              <strong>{filename}</strong>
              <small>{headers.length} detected columns</small>
            </div>
            <Badge tone="green">Ready to map</Badge>
          </div>
          <div className="mapping-grid">
            <strong>Portfolio field</strong>
            <strong>Your CSV column</strong>
            {fields.map((field) => (
              <div className="contents" key={field.id}>
                <label htmlFor={`map-${field.id}`}>
                  {field.name}
                  {field.id === 'name' && ' *'}
                </label>
                <select
                  id={`map-${field.id}`}
                  value={mapping[field.id] || ''}
                  onChange={(e) => setMapping({ ...mapping, [field.id]: e.target.value })}
                >
                  <option value="">Skip this field</option>
                  {headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
          <label className="check-label">
            <input
              type="checkbox"
              checked={overwrite}
              onChange={(e) => setOverwrite(e.target.checked)}
            />{' '}
            Update matching domains with mapped CSV fields (existing listings stay unchanged)
          </label>
          <div className="dialog-actions">
            <Button onClick={() => setStep(0)}>Back</Button>
            <Button variant="primary" disabled={busy || !mapping.name} onClick={() => void next()}>
              {busy ? 'Validating…' : 'Preview import'}
              <ArrowRight size={16} />
            </Button>
          </div>
        </div>
      )}
      {step === 2 && preview && (
        <div className="stack">
          <div className="import-stats">
            <div>
              <strong>{preview.inserts}</strong>new domains
            </div>
            <div>
              <strong>{preview.updates}</strong>updates
            </div>
            <div>
              <strong>{preview.skipped}</strong>skipped existing
            </div>
            <div>
              <strong>{preview.errors.length}</strong>invalid rows
            </div>
          </div>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Domain</th>
                  <th>Acquisition cost</th>
                  <th>Asking price</th>
                </tr>
              </thead>
              <tbody>
                {preview.preview.map((d) => (
                  <tr key={d.name}>
                    <td className="domain-name">{d.name}</td>
                    <td>{formatMoney(d.acquisitionCost, d.currency)}</td>
                    <td>{formatMoney(d.askingPrice, d.currency)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {preview.errors.length > 0 && (
            <div className="notice notice-amber">
              <AlertCircle size={17} />
              <div>
                <strong>Invalid rows will be skipped</strong>
                {preview.errors.slice(0, 8).map((e, i) => (
                  <p key={i}>
                    Row {e.row}: {e.message}
                  </p>
                ))}
                {preview.errors.length > 8 && <p>And {preview.errors.length - 8} more errors.</p>}
              </div>
            </div>
          )}
          <p className="muted text-xs">Preview shows up to 10 rows. Import is atomic.</p>
          <div className="dialog-actions">
            <Button onClick={() => setStep(1)}>Back to mapping</Button>
            <Button variant="primary" disabled={busy || !preview.valid} onClick={() => void next()}>
              {busy ? 'Importing…' : `Confirm ${preview.valid} valid rows`}
            </Button>
          </div>
        </div>
      )}
      {step === 3 && preview && (
        <div className="import-complete">
          <span>
            <Check size={30} />
          </span>
          <h3>Your portfolio is a little more connected.</h3>
          <p>
            {preview.inserts} domains added · {preview.updates} updated · {preview.skipped} skipped
          </p>
          <Button variant="primary" onClick={() => onOpenChange(false)}>
            View portfolio
            <ArrowRight size={16} />
          </Button>
        </div>
      )}
    </Modal>
  );
}
