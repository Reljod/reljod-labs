import { describe, expect, it } from "vitest";
import { audienceFromHint, cookieValue } from "./audience";

describe("Audience", () => {
  it("names a Host and a Guest from the profile hint", () => {
    expect(audienceFromHint("host")).toBe("host");
    expect(audienceFromHint("guest")).toBe("guest");
  });

  it("counts no hint, an old hint or a forged one as a visitor", () => {
    expect(audienceFromHint(null)).toBe("visitor");
    expect(audienceFromHint("1")).toBe("visitor");
    expect(audienceFromHint("admin")).toBe("visitor");
  });

  it("reads one cookie out of document.cookie", () => {
    const jar = "a=1; labs_profile=guest; sb-x-auth-token=abc=def";
    expect(cookieValue(jar, "labs_profile")).toBe("guest");
    expect(cookieValue(jar, "sb-x-auth-token")).toBe("abc=def");
    expect(cookieValue(jar, "missing")).toBeNull();
    expect(cookieValue("", "labs_profile")).toBeNull();
  });
});
