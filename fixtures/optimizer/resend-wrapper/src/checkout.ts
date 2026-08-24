import { emailProvider } from "./provider";
export function notifyCustomer(to: string) {
  return emailProvider.send({ from: "shop@example.com", to, subject: "Order confirmed", text: "Thanks" });
}
