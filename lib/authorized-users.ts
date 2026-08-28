import type { PersonId } from "@/lib/finance-domain";

export type AuthorizedUser = {
  email: string;
  person: PersonId;
  name: "Kim" | "Alexandre";
};

const AUTHORIZED_USERS: Record<string, AuthorizedUser> = {
  "eliakim.minichiello@gmail.com": {
    email: "eliakim.minichiello@gmail.com",
    person: "kim",
    name: "Kim",
  },
  "pantoja.smp@gmail.com": {
    email: "pantoja.smp@gmail.com",
    person: "alexandre",
    name: "Alexandre",
  },
};

export function getAuthorizedUser(email: string | null | undefined) {
  if (!email) return null;
  return AUTHORIZED_USERS[email.trim().toLowerCase()] ?? null;
}
