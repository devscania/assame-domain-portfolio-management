import 'dotenv/config';
import nodemailer from 'nodemailer-modern';
import { smtpConfiguration } from '../src/lib/smtp-config';

const { invalid, options } = smtpConfiguration(process.env);
if (invalid.length) {
  console.error(`Invalid SMTP configuration: ${invalid.join(', ')}`);
  process.exitCode = 1;
} else {
  const transport = nodemailer.createTransport(options);
  try {
    await transport.verify();
    console.log('SMTP connection verified. No message was sent.');
  } catch (error) {
    const code = (error as { code?: string } | null)?.code;
    const reason =
      code === 'EAUTH'
        ? 'The server rejected authentication. Check the mailbox settings and credentials.'
        : code === 'ETLS'
          ? 'TLS negotiation failed. Check the configured port and TLS mode.'
          : 'Check SMTP reachability, TLS settings and credentials.';
    // Raw SMTP errors can include server replies, addresses and authentication details.
    console.error(`SMTP verification failed. ${reason}`);
    process.exitCode = 1;
  } finally {
    transport.close();
  }
}
