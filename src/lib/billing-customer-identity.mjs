export function billingCustomerUserFilter(userId){
  const value=String(userId||"").trim();
  if(!value)throw new Error("Billing customer user id is required");
  return `auth_user_id.eq.${value},user_id.eq.${value}`;
}
