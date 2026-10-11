import {readFileSync} from 'node:fs';

// Vercel CLI populates .vercel/.env.production.local during `vercel pull`.
// Node's --env-file option parses the file without running its contents as shell code.
// Public Supabase configuration is owned by the existing scoped Vercel project,
// not by a Supabase Management API token in GitHub Actions.
export function validateBillingPublicEnv(env,projectRef='hdwijbdxmpwlltnfrbsc'){
  const expected='https://'+projectRef+'.supabase.co';
  const url=String(env.NEXT_PUBLIC_SUPABASE_URL||'').trim().replace(/\/+$/,'');
  const key=String(env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||'').trim();
  if(url!==expected)throw new Error('Vercel production Supabase URL does not match the confirmed Billing Store project');
  if(!key||key==='[SENSITIVE]'||key==='[ENCRYPTED]'||
     !(key.startsWith('sb_publishable_')||/^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(key)))
    throw new Error('Vercel production Supabase publishable/anon key is missing, unavailable or invalid');
  return {projectRef,expectedUrl:expected};
}

if(process.argv[1]?.endsWith('/verify-billing-public-env.mjs')){
  const path='.vercel/.env.production.local';
  try{readFileSync(path);}catch{throw new Error('Missing production Vercel env file; run vercel pull before validation');}
  const info=validateBillingPublicEnv(process.env);
  console.log('Validated public Billing Store Supabase build configuration for '+info.projectRef+'.');
}
