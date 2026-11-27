export type BillingEmailEvent = {key:string;name:string;category:string;description:string;variables:readonly {name:string;sensitive?:boolean}[]};
export const BILLING_EMAIL_EVENTS: readonly BillingEmailEvent[];
export function getBillingEmailEvent(key:string): BillingEmailEvent | null;
