import test from "node:test";
import assert from "node:assert/strict";
import {
  ownerColumnsForSelection,
  ownerSelectionOptions,
} from "../lib/owner-selection.ts";

const members = [
  { personKey: "kim" as const, memberId: "member-kim" },
  { personKey: "alexandre" as const, memberId: "member-ale" },
];

test("oferece Kim, Grupo e Ale em uma ordem única", () => {
  assert.deepEqual(ownerSelectionOptions, [
    { value: "kim", label: "Kim" },
    { value: "joint", label: "Grupo" },
    { value: "alexandre", label: "Ale" },
  ]);
});

test("atribui qualquer documento à pessoa selecionada", () => {
  assert.deepEqual(ownerColumnsForSelection("kim", members), {
    owner_scope: "individual",
    owner_member_id: "member-kim",
  });
  assert.deepEqual(ownerColumnsForSelection("joint", members), {
    owner_scope: "joint",
    owner_member_id: null,
  });
  assert.deepEqual(ownerColumnsForSelection("alexandre", members), {
    owner_scope: "individual",
    owner_member_id: "member-ale",
  });
});

test("não troca silenciosamente o responsável quando ele ainda não entrou", () => {
  assert.throws(
    () => ownerColumnsForSelection("alexandre", members.slice(0, 1)),
    /Ale ainda não possui acesso/,
  );
});
