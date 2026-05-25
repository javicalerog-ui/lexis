// =====================================================
// Adapter Resend para envío de digests
// (Resend ya está configurado para magic links)
// =====================================================

const RESEND_ENDPOINT = 'https://api.resend.com/emails';

export interface SendEmailParams {
  to: string;
  subject: string;
  html: string;
  text?: string;
  from?: string;
  replyTo?: string;
  tags?: Array<{ name: string; value: string }>;
}

export interface SendEmailResult {
  id: string;
  to: string;
  from: string;
}

export async function sendEmail(params: SendEmailParams): Promise<SendEmailResult> {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error('RESEND_API_KEY no configurada');

  const from =
    params.from ||
    process.env.RESEND_DIGEST_FROM ||
    process.env.RESEND_FROM ||
    process.env.RESEND_FROM_EMAIL;
  if (!from) {
    throw new Error(
      'RESEND_DIGEST_FROM, RESEND_FROM o RESEND_FROM_EMAIL no configurada'
    );
  }

  const res = await fetch(RESEND_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [params.to],
      subject: params.subject,
      html: params.html,
      text: params.text,
      reply_to: params.replyTo,
      tags: params.tags,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Resend error (${res.status}): ${errText.slice(0, 400)}`);
  }

  const data = (await res.json()) as { id: string };
  return {
    id: data.id,
    to: params.to,
    from,
  };
}
