import test from "node:test";
import assert from "node:assert/strict";
import {billingCustomerUserFilter} from "../src/lib/billing-customer-identity.mjs";

test("matches both current and legacy Billing customer user links",()=>{
  assert.equal(
    billingCustomerUserFilter("123e4567-e89b-12d3-a456-426614174000"),
    "auth_user_id.eq.123e4567-e89b-12d3-a456-426614174000,user_id.eq.123e4567-e89b-12d3-a456-426614174000"
  );
});

test("rejects an empty customer user id",()=>{
  assert.throws(()=>billingCustomerUserFilter("   "),/user id is required/i);
});
