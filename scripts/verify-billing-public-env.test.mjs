import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {validateBillingPublicEnv} from './verify-billing-public-env.mjs';

const expected='https://hdwijbdxmpwlltnfrbsc.supabase.co';
const valid={NEXT_PUBLIC_SUPABASE_URL:expected,NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_example-test-key'};
test('accepts scoped Billing publishable build settings',()=>{
  assert.deepEqual(validateBillingPublicEnv(valid),{projectRef:'hdwijbdxmpwlltnfrbsc',expectedUrl:expected});
});
test('rejects a key or URL for another Supabase project',()=>{
  assert.throws(()=>validateBillingPublicEnv({...valid,NEXT_PUBLIC_SUPABASE_URL:'https://other.supabase.co'}),/does not match/);
});
test('rejects sensitive pull placeholders and empty keys',()=>{
  for(const key of ['','[SENSITIVE]','[ENCRYPTED]','not-a-key'])
    assert.throws(()=>validateBillingPublicEnv({...valid,NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:key}),/missing, unavailable or invalid/);
});
test('both manual deploy workflows use Vercel public configuration without Management API access',()=>{
  for(const workflow of ['quick-redesign-deploy.yml','production-deploy.yml']){
    const src=readFileSync('.github/workflows/'+workflow,'utf8');
    assert.match(src,/vercel pull --yes --environment=production/);
    assert.match(src,/node --env-file=\.vercel\/\.env\.production\.local scripts\/verify-billing-public-env\.mjs/);
    assert.doesNotMatch(src,/api\.supabase\.com\/v1\/projects\/\$SUPABASE_PROJECT_ID\/api-keys/);
    assert.doesNotMatch(src,/secrets\.SUPABASE_ACCESS_TOKEN/);
    assert.match(src,/workflow_dispatch/);
  }
});
