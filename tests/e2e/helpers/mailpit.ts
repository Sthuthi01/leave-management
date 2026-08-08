const MAILPIT_URL = process.env.MAILPIT_URL ?? "http://localhost:8025";

interface MailpitMessageSummary {
  ID: string;
  To: { Address: string }[];
  Subject: string;
  Created: string;
}

interface MailpitMessageDetail {
  Text: string;
}

/**
 * Polls Mailpit for the most recent email to `to` whose subject contains `subjectContains`,
 * sent after `sentAfter` (so a re-run doesn't pick up a stale email from a previous run to the
 * same address), and returns the set-password link found in its body.
 */
export async function waitForSetPasswordLink(to: string, subjectContains: string, sentAfter: Date): Promise<string> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const res = await fetch(`${MAILPIT_URL}/api/v1/messages?limit=50`);
    const data = (await res.json()) as { messages: MailpitMessageSummary[] };
    const match = data.messages
      .filter((m) => m.To.some((t) => t.Address === to) && m.Subject.includes(subjectContains) && new Date(m.Created) >= sentAfter)
      .sort((a, b) => new Date(b.Created).getTime() - new Date(a.Created).getTime())[0];

    if (match) {
      const detailRes = await fetch(`${MAILPIT_URL}/api/v1/message/${match.ID}`);
      const detail = (await detailRes.json()) as MailpitMessageDetail;
      const linkMatch = detail.Text.match(/https?:\/\/\S+\/set-password\?token=\S+?(?=[).\s]|$)/);
      if (linkMatch) return linkMatch[0];
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for an email to ${to} with subject containing "${subjectContains}"`);
}
