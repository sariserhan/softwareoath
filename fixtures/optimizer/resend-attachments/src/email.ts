import { Resend } from "resend";
const resend = new Resend(process.env.RESEND_API_KEY);
export function sendInvoice(to: string, content: string) {
  return resend.emails.send({ from: "billing@example.com", to, subject: "Invoice", attachments: [{ filename: "invoice.pdf", content }] });
}
