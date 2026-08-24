export function receive(event: { type: string; data: { emailId?: string } }) {
  if (event.type !== "email.received") return;
  return event.data.emailId;
}
