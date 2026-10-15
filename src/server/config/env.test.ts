import { afterEach, describe, expect, it } from "vitest";
import { ConfigError, stripeSecretKey } from "./env";

const original = process.env.STRIPE_SECRET_KEY;
afterEach(() => {
  process.env.STRIPE_SECRET_KEY = original;
});

describe("Stripe test-mode guard", () => {
  it("refuses live keys", () => {
    process.env.STRIPE_SECRET_KEY = "sk_live_abc";
    expect(() => stripeSecretKey()).toThrow(ConfigError);
  });
  it("accepts test keys", () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_abc";
    expect(stripeSecretKey()).toBe("sk_test_abc");
  });
  it("gives a readable error when missing", () => {
    delete process.env.STRIPE_SECRET_KEY;
    expect(() => stripeSecretKey()).toThrow(/Missing STRIPE_SECRET_KEY/);
  });
});
