//   Copyright 2026 The Tari Project
//   SPDX-License-Identifier: BSD-3-Clause

import type {
  AccessRule,
  ComponentAddress,
  InstructionArg,
  NonFungibleAddress,
  PublishedTemplateAddress,
  ResourceAddress,
  RestrictedAccessRule,
  RistrettoPublicKeyBytes,
  RuleRequirement,
} from "@tari-project/ootle-ts-bindings";
import { InvalidArgumentError } from "../errors";
import type { CborEncodable } from "./cbor-builder";
import { accessRuleLiteral, publicKeyRequirement } from "./cbor-literal";

const templateHash = (address: PublishedTemplateAddress | string): string => address.replace(/^template_/, "");

/** The conditions an access rule can require. Combine them with {@link AccessRuleBuilder}. */
export const requirement = {
  /** A transaction signed by `publicKey`: the Rust `public_key(pk)`. */
  publicKey: (publicKey: RistrettoPublicKeyBytes | Uint8Array): RuleRequirement => publicKeyRequirement(publicKey),
  /** A proof of any amount of `resource`. */
  resource: (resource: ResourceAddress): RuleRequirement => ({ Resource: resource }),
  /** A proof of one non-fungible token. */
  nonFungible: (address: NonFungibleAddress): RuleRequirement => ({ NonFungibleAddress: address }),
  /** Running inside `component`. */
  scopedToComponent: (component: ComponentAddress): RuleRequirement => ({ ScopedToComponent: component }),
  /** Running inside `template`. */
  scopedToTemplate: (template: PublishedTemplateAddress | string): RuleRequirement => ({
    ScopedToTemplate: templateHash(template),
  }),
  /** Called by `component`. */
  callerComponent: (component: ComponentAddress): RuleRequirement => ({ CallerComponent: component }),
  /** Called directly by a component or function of `template`. */
  directCallerTemplate: (template: PublishedTemplateAddress | string): RuleRequirement => ({
    DirectCallerTemplate: templateHash(template),
  }),
} as const;

/**
 * Builds an `AccessRule`. `publicKey`, `resource`, `anyOf`, `allOf` and `mOfN` give the same rule
 * as the Rust `rule!` macro does for `public_key`, `resource`, `any_of`, `all_of` and `m_of_n`.
 *
 * ```ts
 * AccessRuleBuilder.publicKey(pk).build();
 * AccessRuleBuilder.mOfN(2, requirement.publicKey(a), requirement.publicKey(b), requirement.publicKey(c)).build();
 * AccessRuleBuilder.publicKey(pk).or(AccessRuleBuilder.resource(badge)).toLiteral();
 * ```
 *
 * `build()` gives the rule object, for `TransactionBuilder.setComponentAccessRules` and the
 * like. `toLiteral()` gives the encoded template argument; a builder can also be passed
 * straight to a `CborBuilder` field.
 */
export class AccessRuleBuilder implements CborEncodable {
  private constructor(private readonly rule: AccessRule) {}

  /** Anyone. */
  public static allowAll(): AccessRuleBuilder {
    return new AccessRuleBuilder("AllowAll");
  }

  /** No one but the owner. */
  public static denyAll(): AccessRuleBuilder {
    return new AccessRuleBuilder("DenyAll");
  }

  /** Continues from an existing rule, e.g. one read from a component. */
  public static from(rule: AccessRule): AccessRuleBuilder {
    return new AccessRuleBuilder(rule);
  }

  /** A single requirement. */
  public static require(rule: RuleRequirement): AccessRuleBuilder {
    return new AccessRuleBuilder({ Restricted: { Require: { Require: rule } } });
  }

  /** Signed by `publicKey`. Shorthand for `require(requirement.publicKey(publicKey))`. */
  public static publicKey(publicKey: RistrettoPublicKeyBytes | Uint8Array): AccessRuleBuilder {
    return AccessRuleBuilder.require(requirement.publicKey(publicKey));
  }

  /** Holding `resource`. Shorthand for `require(requirement.resource(resource))`. */
  public static resource(resource: ResourceAddress): AccessRuleBuilder {
    return AccessRuleBuilder.require(requirement.resource(resource));
  }

  /** At least one of `rules`. Each is a requirement or a nested rule. */
  public static anyOf(...rules: (RuleRequirement | AccessRuleBuilder)[]): AccessRuleBuilder {
    return AccessRuleBuilder.combine("AnyOf", rules);
  }

  /** Every one of `rules`. Each is a requirement or a nested rule. */
  public static allOf(...rules: (RuleRequirement | AccessRuleBuilder)[]): AccessRuleBuilder {
    return AccessRuleBuilder.combine("AllOf", rules);
  }

  /** At least `m` of `requirements`, which must be distinct. */
  public static mOfN(m: number, ...requirements: RuleRequirement[]): AccessRuleBuilder {
    return new AccessRuleBuilder({ Restricted: { Require: { MOfN: [m, requirements] } } });
  }

  /** This rule or `other`. `allowAll` wins and `denyAll` yields to the other side, as in Rust. */
  public or(other: AccessRuleBuilder | RuleRequirement): AccessRuleBuilder {
    const [a, b] = [this.rule, AccessRuleBuilder.lift(other).rule];
    if (a === "AllowAll" || b === "AllowAll") return AccessRuleBuilder.allowAll();
    if (a === "DenyAll") return new AccessRuleBuilder(b);
    if (b === "DenyAll") return new AccessRuleBuilder(a);
    return new AccessRuleBuilder({ Restricted: { AnyOf: [a.Restricted, b.Restricted] } });
  }

  /** This rule and `other`. `denyAll` wins and `allowAll` yields to the other side, as in Rust. */
  public and(other: AccessRuleBuilder | RuleRequirement): AccessRuleBuilder {
    const [a, b] = [this.rule, AccessRuleBuilder.lift(other).rule];
    if (a === "DenyAll" || b === "DenyAll") return AccessRuleBuilder.denyAll();
    if (a === "AllowAll") return new AccessRuleBuilder(b);
    if (b === "AllowAll") return new AccessRuleBuilder(a);
    return new AccessRuleBuilder({ Restricted: { AllOf: [a.Restricted, b.Restricted] } });
  }

  /**
   * The rule object.
   *
   * @throws {InvalidArgumentError} if the rule is one the engine refuses to store (see
   *   {@link accessRuleLiteral}) or holds a malformed address.
   */
  public build(): AccessRule {
    accessRuleLiteral(this.rule);
    return this.rule;
  }

  /**
   * The rule encoded as a template argument.
   *
   * @throws {InvalidArgumentError} as for {@link AccessRuleBuilder.build}.
   */
  public toLiteral(): InstructionArg {
    return accessRuleLiteral(this.rule);
  }

  private static lift(rule: AccessRuleBuilder | RuleRequirement): AccessRuleBuilder {
    return rule instanceof AccessRuleBuilder ? rule : AccessRuleBuilder.require(rule);
  }

  // Each item becomes a rule of its own, as `rule!(any_of(..))` and `rule!(all_of(..))` write it.
  private static combine(kind: "AnyOf" | "AllOf", rules: (RuleRequirement | AccessRuleBuilder)[]): AccessRuleBuilder {
    const nested = rules.map((rule): RestrictedAccessRule => {
      const inner = AccessRuleBuilder.lift(rule).rule;
      if (typeof inner === "string") {
        throw new InvalidArgumentError(`AccessRuleBuilder: ${inner} cannot be nested inside ${kind}; use or()/and()`);
      }
      return inner.Restricted;
    });
    return new AccessRuleBuilder({ Restricted: kind === "AnyOf" ? { AnyOf: nested } : { AllOf: nested } });
  }
}
