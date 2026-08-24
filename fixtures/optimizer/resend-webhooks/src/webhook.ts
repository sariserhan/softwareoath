export function handleResendWebhook(event: { type: string }) {
  if (event.type === "email.delivered") return "delivered";
  if (event.type === "email.bounced") return "bounced";
  return "ignored";
}
