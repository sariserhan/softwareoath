import { createCompatibilityAssessment } from "./compatibility.js";
import type {
  CapabilityAssessmentV1,
  CapabilityEvidenceV1,
  CapabilitySupport,
  CompatibilityAssessmentV1,
} from "./types.js";

export type EmailCapabilityId =
  | "transactional_send"
  | "html_email"
  | "text_email"
  | "attachments"
  | "provider_templates"
  | "batch_send"
  | "scheduled_send"
  | "message_tags"
  | "idempotency"
  | "delivery_webhooks"
  | "inbound_email"
  | "contacts_audiences"
  | "sending_domains";

export type EmailTargetServiceId = "ses" | "postmark";

export interface CatalogCapabilityV1 {
  support: CapabilitySupport;
  notes: string[];
  sourceUrls: string[];
}

export interface EmailProviderCatalogEntryV1 {
  serviceId: EmailTargetServiceId;
  capabilities: Record<EmailCapabilityId, CatalogCapabilityV1>;
  operationalDifferences: string[];
  unresolvedOwnerInputs: string[];
}

export interface EmailCompatibilityCatalogV1 {
  version: 1;
  catalogVersion: string;
  verifiedAt: string;
  providers: Record<EmailTargetServiceId, EmailProviderCatalogEntryV1>;
}

const sesSend =
  "https://docs.aws.amazon.com/ses/latest/APIReference-V2/API_SendEmail.html";
const sesBulk =
  "https://docs.aws.amazon.com/ses/latest/APIReference-V2/API_SendBulkEmail.html";
const sesAttachments =
  "https://docs.aws.amazon.com/ses/latest/dg/attachments.html";
const sesEvents =
  "https://docs.aws.amazon.com/ses/latest/dg/monitor-sending-activity-using-notifications-event-publishing.html";
const sesReceiving =
  "https://docs.aws.amazon.com/ses/latest/dg/receiving-email.html";
const sesContacts =
  "https://docs.aws.amazon.com/ses/latest/APIReference-V2/API_CreateContactList.html";
const sesIdentity =
  "https://docs.aws.amazon.com/ses/latest/dg/creating-identities.html";
const postmarkEmail =
  "https://postmarkapp.com/developer/api/email-api";
const postmarkTemplates =
  "https://postmarkapp.com/developer/api/templates-api";
const postmarkWebhooks =
  "https://postmarkapp.com/developer/api/webhooks-api";
const postmarkInbound =
  "https://postmarkapp.com/developer/webhooks/inbound-webhook";
const postmarkDomains =
  "https://postmarkapp.com/developer/api/domains-api";

function capability(
  support: CapabilitySupport,
  notes: string[],
  sourceUrls: string[],
): CatalogCapabilityV1 {
  return { support, notes, sourceUrls };
}

export const emailCompatibilityCatalogV1: EmailCompatibilityCatalogV1 = {
  version: 1,
  catalogVersion: "email-2026-08-24",
  verifiedAt: "2026-08-24T00:00:00.000Z",
  providers: {
    ses: {
      serviceId: "ses",
      capabilities: {
        transactional_send: capability("exact", [], [sesSend]),
        html_email: capability("exact", [], [sesSend]),
        text_email: capability("exact", [], [sesSend]),
        attachments: capability(
          "supported_with_changes",
          ["Attachment encoding, MIME handling, and size limits differ."],
          [sesAttachments],
        ),
        provider_templates: capability(
          "supported_with_changes",
          ["Templates and substitution data must be migrated into SES."],
          [sesSend, sesBulk],
        ),
        batch_send: capability(
          "supported_with_changes",
          ["SES bulk entry limits and templated bulk semantics differ from Resend."],
          [sesBulk],
        ),
        scheduled_send: capability(
          "unsupported",
          ["SES has no native send-at operation; scheduling needs external orchestration."],
          [sesSend],
        ),
        message_tags: capability(
          "supported_with_changes",
          ["SES message tags use name/value pairs and configuration-set event publishing."],
          [sesSend],
        ),
        idempotency: capability(
          "unsupported",
          ["SES SendEmail does not expose an idempotency-key contract."],
          [sesSend],
        ),
        delivery_webhooks: capability(
          "supported_with_changes",
          ["Delivery events require configuration sets and an AWS event destination."],
          [sesEvents],
        ),
        inbound_email: capability(
          "supported_with_changes",
          ["Inbound processing uses regional receipt rules and AWS destinations."],
          [sesReceiving],
        ),
        contacts_audiences: capability(
          "supported_with_changes",
          ["SES contact lists/topics differ from Resend audience and contact semantics."],
          [sesContacts],
        ),
        sending_domains: capability(
          "supported_with_changes",
          ["Domains become SES identities with AWS-specific DNS and regional state."],
          [sesIdentity],
        ),
      },
      operationalDifferences: [
        "The owner assumes more responsibility for deliverability, reputation, and suppression operations.",
        "Sending quotas, sandbox exit, identities, receipt support, and endpoints are region-specific.",
        "Dedicated IPs, configuration sets, SNS/EventBridge destinations, and AWS support are separate operational choices.",
        "IAM scoping and AWS account controls replace a provider-scoped API key.",
      ],
      unresolvedOwnerInputs: [
        "AWS region and account",
        "sandbox/production access and sending quota",
        "dedicated IP and managed deliverability requirements",
        "receipt-rule region and destinations",
        "compliance, data-residency, and AWS support requirements",
      ],
    },
    postmark: {
      serviceId: "postmark",
      capabilities: {
        transactional_send: capability("exact", [], [postmarkEmail]),
        html_email: capability("exact", [], [postmarkEmail]),
        text_email: capability("exact", [], [postmarkEmail]),
        attachments: capability(
          "supported_with_changes",
          ["Attachments require Postmark base64 fields and Postmark limits/file rules."],
          [postmarkEmail],
        ),
        provider_templates: capability(
          "supported_with_changes",
          ["Templates, aliases, models, and layout behavior must be migrated."],
          [postmarkTemplates],
        ),
        batch_send: capability(
          "supported_with_changes",
          ["Postmark batch endpoints have per-call message and payload limits."],
          [postmarkEmail, postmarkTemplates],
        ),
        scheduled_send: capability(
          "unsupported",
          ["Postmark has no documented native send-at field; scheduling stays application-owned."],
          [postmarkEmail],
        ),
        message_tags: capability(
          "supported_with_changes",
          ["Postmark supports one Tag plus Metadata rather than Resend tag semantics."],
          [postmarkEmail],
        ),
        idempotency: capability(
          "unsupported",
          ["Postmark send endpoints do not document an idempotency-key contract."],
          [postmarkEmail],
        ),
        delivery_webhooks: capability(
          "supported_with_changes",
          ["Webhook event types, signatures, payloads, retries, and stream configuration differ."],
          [postmarkWebhooks],
        ),
        inbound_email: capability(
          "supported_with_changes",
          ["Inbound mail is delivered through a Postmark inbound stream and JSON webhook."],
          [postmarkInbound],
        ),
        contacts_audiences: capability(
          "unsupported",
          ["The reviewed Postmark APIs do not provide a Resend-equivalent audience/contact store."],
          [postmarkEmail],
        ),
        sending_domains: capability(
          "supported_with_changes",
          ["Sender signatures and domain verification use Postmark-specific DNS and approval."],
          [postmarkDomains],
        ),
      },
      operationalDifferences: [
        "Transactional and broadcast traffic must use the correct Postmark message streams.",
        "Sender signatures/domain verification and account approval replace Resend domain state.",
        "Postmark owns more deliverability infrastructure, while message limits and attachment rules differ.",
        "Webhook configuration, retry behavior, suppressions, and support processes are provider-specific.",
      ],
      unresolvedOwnerInputs: [
        "transactional versus broadcast stream requirements",
        "dedicated IP and deliverability requirements",
        "sender signature/domain ownership",
        "inbound stream and webhook requirements",
        "compliance, data-residency, and support requirements",
      ],
    },
  },
};

export function assessEmailCompatibility(options: {
  targetServiceId: EmailTargetServiceId;
  capabilities: CapabilityEvidenceV1[];
  catalog?: EmailCompatibilityCatalogV1;
}): CompatibilityAssessmentV1 {
  const catalog = options.catalog ?? emailCompatibilityCatalogV1;
  const provider = catalog.providers[options.targetServiceId];
  const assessments: CapabilityAssessmentV1[] = options.capabilities.map(
    (observed) => {
      const definition =
        provider.capabilities[observed.capabilityId as EmailCapabilityId];
      return {
        capabilityId: observed.capabilityId,
        requirement: observed.requirement,
        support: definition?.support ?? "unverified",
        notes: definition?.notes ?? [
          "This capability is absent from the reviewed email catalog.",
        ],
      };
    },
  );
  const sourceUrls = [...new Set(options.capabilities.flatMap((observed) =>
    provider.capabilities[observed.capabilityId as EmailCapabilityId]
      ?.sourceUrls ?? []))];
  const semanticDifferences = assessments
    .filter((item) => item.support !== "exact")
    .flatMap((item) => item.notes.map(
      (note) => item.capabilityId + ": " + note,
    ));
  const unknowns = provider.unresolvedOwnerInputs.map(
    (input) => "Owner input required: " + input + ".",
  );
  return createCompatibilityAssessment({
    sourceServiceId: "resend",
    targetServiceId: options.targetServiceId,
    capabilities: assessments,
    semanticDifferences,
    operationalDifferences: provider.operationalDifferences,
    unknowns: [
      ...unknowns,
      ...assessments
        .filter((item) => item.support === "unverified")
        .map((item) =>
          "Catalog support is unverified for " + item.capabilityId + "."),
    ],
    catalogVersion: catalog.catalogVersion,
    catalogVerifiedAt: catalog.verifiedAt,
    catalogSources: sourceUrls.map((url) => ({
      url,
      verifiedAt: catalog.verifiedAt,
    })),
  });
}
