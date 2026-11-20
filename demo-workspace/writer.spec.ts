import { test, expect } from "vitest";
import { writeRows, writeHeaderOnly } from "./writer";

test("empty", () => {
  expect(writeRows([])).toBe(writeHeaderOnly());
});

test("non-empty", () => {
  expect(writeRows([{ id: "o1", amount: 10 }])).toBe("id,amount\no1,10\n");
});
