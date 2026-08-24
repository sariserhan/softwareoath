import { Resend } from "resend";
const resend = new Resend(process.env.RESEND_API_KEY);
export function announce(messages: object[]) { return resend.batch.send(messages); }
