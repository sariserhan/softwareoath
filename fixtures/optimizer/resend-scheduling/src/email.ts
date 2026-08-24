import { Resend } from "resend";
const resend = new Resend(process.env.RESEND_API_KEY);
export function remind(to: string, scheduledAt: string) {
  return resend.emails.send({ from: "reminders@example.com", to, subject: "Reminder", text: "Reminder", scheduledAt });
}
