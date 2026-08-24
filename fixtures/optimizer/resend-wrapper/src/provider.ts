import { Resend } from "resend";
const client = new Resend(process.env.RESEND_API_KEY);
export const emailProvider = { send: (message: object) => client.emails.send(message) };
