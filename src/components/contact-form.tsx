'use client';
import { useState } from 'react';
import { trackContactSubmission } from './analytics';
import { ArrowUpRight, CheckCircle2, CircleAlert } from 'lucide-react';
import { contactKindLabels, contactKinds, type ContactKind } from '@/lib/contact-kind';

export function ContactForm({ initialKind = 'contact' }: { initialKind?: ContactKind }) {
  const [kind, setKind] = useState(initialKind);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<'success' | 'error' | null>(null);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setBusy(true);
    setMessage('');
    setStatus(null);
    try {
      const response = await fetch('/api/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.fromEntries(new FormData(form))),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      trackContactSubmission();
      form.reset();
      setMessage('Your request has been received.');
      setStatus('success');
    } catch (error) {
      setStatus('error');
      setMessage(error instanceof Error ? error.message : 'Unable to send your request.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <form method="post" className="contact-form" onSubmit={submit}>
      <div className="contact-form-heading">
        <span className="marketing-kicker">START A CONVERSATION</span>
        <h2>Send a message</h2>
        <p>A few details help us understand what you need.</p>
      </div>
      <label>
        Request type
        <select
          name="kind"
          className="input"
          value={kind}
          onChange={(event) => setKind(event.target.value as ContactKind)}
        >
          {contactKinds.map((value) => (
            <option key={value} value={value}>
              {contactKindLabels[value]}
            </option>
          ))}
        </select>
      </label>
      <label>
        Name
        <input name="name" maxLength={100} autoComplete="name" placeholder="Your name" required />
      </label>
      <label>
        Email
        <input
          name="email"
          type="email"
          maxLength={254}
          autoComplete="email"
          placeholder="you@example.com"
          required
        />
      </label>
      <label>
        {kind === 'bug'
          ? 'What happened?'
          : kind === 'feature'
            ? 'What would you like to do?'
            : 'How can we help?'}
        <textarea
          name="message"
          minLength={10}
          maxLength={5000}
          rows={6}
          required
          placeholder={
            kind === 'bug'
              ? 'Include the page, steps to reproduce the issue, and what you expected to happen.'
              : kind === 'feature'
                ? 'Describe the workflow and how this feature would help.'
                : 'Tell us about your portfolio or question.'
          }
        />
      </label>
      <p>Please do not include passwords, API keys or payment information.</p>
      <button className="marketing-button" disabled={busy}>
        {busy ? 'Sending…' : 'Send request'} <ArrowUpRight size={16} aria-hidden="true" />
      </button>
      {message && (
        <p
          className={`contact-feedback contact-feedback-${status}`}
          role={status === 'error' ? 'alert' : 'status'}
        >
          {status === 'success' ? (
            <CheckCircle2 size={18} aria-hidden="true" />
          ) : (
            <CircleAlert size={18} aria-hidden="true" />
          )}
          {message}
        </p>
      )}
    </form>
  );
}
