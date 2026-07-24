import { describe, expect, it } from "vitest";
import { validateSteps } from "./lifeplan-core.mjs";

const playbooks = [
  {
    id: "iwt",
    principles: [
      { id: "p1", topic: "spending", text: "t", quote: "q", verified: true },
      { id: "p2", topic: "debt", text: "t", quote: "q", verified: true },
    ],
  },
];

describe("validateSteps", () => {
  it("keeps steps whose citations all resolve, drops the rest", () => {
    const { steps, droppedSteps } = validateSteps(
      [
        { title: "Good", body: "", citations: [{ playbookId: "iwt", principleId: "p1" }] },
        { title: "Dangling", body: "", citations: [{ playbookId: "iwt", principleId: "p999" }] },
        { title: "Wrong book", body: "", citations: [{ playbookId: "nope", principleId: "p1" }] },
        { title: "Uncited", body: "", citations: [] },
        {
          title: "Half good",
          body: "",
          citations: [
            { playbookId: "iwt", principleId: "p2" },
            { playbookId: "iwt", principleId: "ghost" },
          ],
        },
      ],
      playbooks,
    );
    expect(steps.map((s) => s.title)).toEqual(["Good"]);
    expect(droppedSteps).toBe(4);
  });

  it("caps at 12 steps and tolerates garbage", () => {
    const good = { title: "s", body: "", citations: [{ playbookId: "iwt", principleId: "p1" }] };
    const { steps } = validateSteps(Array(20).fill(good), playbooks);
    expect(steps).toHaveLength(12);
    expect(validateSteps(undefined, playbooks).steps).toEqual([]);
    expect(validateSteps([null, 42, {}], playbooks).droppedSteps).toBe(3);
  });
});
