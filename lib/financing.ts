import { createHash } from "node:crypto";
import { normalizeMerchant } from "./finance-domain.ts";

type FinancingIdentity = {
  institution: string | null;
  contractReference: string | null;
  description: string;
  owner: string;
  fallbackIdentity?: string | null;
};

function normalizeReference(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .replace(/^(contrato|contract|numero|nro|nr)/, "")
    .slice(-80);
}

function normalizeFallbackIdentity(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ":")
    .replace(/^:+|:+$/g, "")
    .slice(0, 240);
}

export function financingContractKey(identity: FinancingIdentity) {
  const institution = normalizeMerchant(identity.institution ?? "")
    .replace(/\b(s a|sa|ltda)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const reference = normalizeReference(identity.contractReference ?? "");
  const fallback = identity.fallbackIdentity
    ? normalizeFallbackIdentity(identity.fallbackIdentity)
    : normalizeMerchant(identity.description);
  const source = reference
    ? `${institution}:contract:${reference}`
    : `${institution}:financing:${fallback}:${identity.owner}`;

  return createHash("sha256").update(source).digest("hex");
}
