import "server-only";
import {createPrivateKey,sign,randomUUID} from "node:crypto";
import {exchangeRemoteIdentity,revokeRemoteSession} from "./remote-staff";
import {listBillingRemoteStaff} from "./billing-sync";

function required(name:string){
  const value=process.env[name]?.trim();
  if(!value)throw new Error(`Remote Staff signing configuration is missing: ${name}`);
  return value;
}
function signActorAssertion(externalUserId:string){
  const algorithm=process.env.MAIL_SYSTEM_REMOTE_STAFF_ALGORITHM||"ES256";
  if(!["RS256","ES256","EdDSA"].includes(algorithm))throw new Error("Remote Staff signing algorithm must be RS256, ES256 or EdDSA.");
  const keyText=required("MAIL_SYSTEM_REMOTE_STAFF_PRIVATE_KEY").replace(/\\n/g,"\n");
  const privateKey=keyText.trim().startsWith("{")
    ?createPrivateKey({key:JSON.parse(keyText),format:"jwk"})
    :createPrivateKey(keyText);
  const header={alg:algorithm,kid:required("MAIL_SYSTEM_REMOTE_STAFF_KEY_ID"),typ:"JWT"};
  const now=Math.floor(Date.now()/1000);
  const claims={iss:required("MAIL_SYSTEM_REMOTE_STAFF_ISSUER"),aud:required("MAIL_SYSTEM_REMOTE_STAFF_AUDIENCE"),sub:externalUserId,iat:now,exp:now+180,jti:randomUUID()};
  const encode=(value:unknown)=>Buffer.from(JSON.stringify(value)).toString("base64url");
  const input=encode(header)+"."+encode(claims);
  const bytes=Buffer.from(input);
  const signature=algorithm==="RS256"
    ?sign("RSA-SHA256",bytes,privateKey)
    :algorithm==="ES256"
      ?sign("sha256",bytes,{key:privateKey,dsaEncoding:"ieee-p1363"})
      :sign(null,bytes,privateKey);
  return input+"."+signature.toString("base64url");
}

/**
 * Creates a short-lived Mail System Remote User session for one Billing staff
 * action, then revokes it. The raw token never reaches the browser or storage.
 */
export async function withBillingRemoteStaffSession<T>(userId:string,operation:(sessionToken:string)=>Promise<T>):Promise<T>{
  const staff=(await listBillingRemoteStaff()).find(person=>person.external_user_id===userId);
  if(!staff||staff.status!=="active")throw new Error("Active Billing staff membership is required for Remote User authentication.");
  const session=await exchangeRemoteIdentity(signActorAssertion(userId));
  try{return await operation(session.access_token);}
  finally{
    try{await revokeRemoteSession(session.access_token);}
    catch(error){console.error("[mail-module] Remote User session revocation failed:",error);}
  }
}
