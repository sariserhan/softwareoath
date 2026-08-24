import { Resend } from "resend";
const resend = new Resend(process.env.RESEND_API_KEY);
export function welcome(to: string) {
  return resend.emails.send({ from: "hello@example.com", to, template: { id: "welcome", variables: { name: "Customer" } } });
}
