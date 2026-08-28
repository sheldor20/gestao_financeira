import type { Owner, PersonId } from "./finance-domain";

export type OwnerMemberReference = {
  personKey: PersonId;
  memberId: string;
};

export const ownerSelectionOptions: Array<{
  value: Owner;
  label: string;
}> = [
  { value: "kim", label: "Kim" },
  { value: "joint", label: "Grupo" },
  { value: "alexandre", label: "Ale" },
];

export function ownerColumnsForSelection(
  owner: Owner,
  members: OwnerMemberReference[],
) {
  if (owner === "joint") {
    return { owner_scope: "joint", owner_member_id: null };
  }

  const member = members.find((item) => item.personKey === owner);
  if (!member) {
    const label = owner === "kim" ? "Kim" : "Ale";
    throw new Error(`${label} ainda não possui acesso ao espaço do casal.`);
  }
  return {
    owner_scope: "individual",
    owner_member_id: member.memberId,
  };
}
