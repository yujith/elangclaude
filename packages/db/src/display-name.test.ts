import { describe, expect, it } from "vitest";
import { firstNameFrom } from "./display-name";

describe("firstNameFrom", () => {
  it("returns the first space-separated token of a plain name", () => {
    expect(firstNameFrom({ name: "Anika", email: "a@x.com" })).toBe("Anika");
    expect(firstNameFrom({ name: "Super Admin", email: "a@x.com" })).toBe(
      "Super",
    );
  });

  it("strips a parenthetical org tag before splitting", () => {
    expect(
      firstNameFrom({
        name: "Anika (Demo English)",
        email: "a@x.com",
      }),
    ).toBe("Anika");
    expect(
      firstNameFrom({
        name: "Devraj (Migration Pathways)",
        email: "d@x.com",
      }),
    ).toBe("Devraj");
  });

  it("falls back to a prettified email local-part when name is null/blank", () => {
    expect(firstNameFrom({ name: null, email: "yujith.perera@gmail.com" })).toBe(
      "Yujith",
    );
    expect(firstNameFrom({ name: "", email: "admin-a@elanguage.dev" })).toBe(
      "Admin",
    );
    expect(firstNameFrom({ name: "   ", email: "u+test@x.com" })).toBe("U");
    expect(firstNameFrom({ name: null, email: "single@x.com" })).toBe("Single");
  });

  it("returns 'there' rather than emitting an empty greeting", () => {
    // Email with no local-part at all — defensive; shouldn't occur in
    // practice but the greeting must never render "Welcome back, .".
    expect(firstNameFrom({ name: null, email: "@x.com" })).toBe("there");
    expect(firstNameFrom({ name: null, email: "" })).toBe("there");
  });
});
