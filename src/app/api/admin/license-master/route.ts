import {createClient} from "@supabase/supabase-js";
import {masterRequest} from "@/lib/master-api";

const SUPABASE_URL=process.env.NEXT_PUBLIC_SUPABASE_URL||"";
const SUPABASE_PUBLISHABLE_KEY=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||"";
const ALLOWED_PREFIXES=["/api/v1"];
