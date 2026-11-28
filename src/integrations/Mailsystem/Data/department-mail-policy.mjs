// @ts-check
/** @type {Record<string,number>} */
const ranks={"support":1,"customer-service-officer":2,"senior-support":3,"customer-service-supervisor":4,"customer-service-manager":5};
/** @type {Record<string,string>} */
const families={"general-support":"general","advanced-general-support":"general","sales-enquiries":"sales","billing-enquiries":"sales","technical-support":"technical","advanced-technical-support":"technical"};
const labels={general:"General Support",sales:"Sales & Billing",technical:"Technical Support"};
/** @param {readonly {id:string,slug?:string,enabled?:boolean}[]} departments */
export function departmentMailGroups(departments){
 const enabled=new Set(departments.filter(d=>d.enabled!==false).map(d=>families[String(d.slug)]).filter(Boolean));
 return ["general","sales","technical"].filter(f=>enabled.has(f)).flatMap(f=>[1,2,3,4,5].map(rank=>({code:"mail-dept-"+f+"-rank-"+rank,name:labels[/** @type {keyof typeof labels} */(f)]+" · "+(["","Tier 1","Tier 2","Tier 3","Supervisor","Manager"][rank]),permissions:/** @type {string[]} */([])})));
}
/** @param {readonly string[]} groupCodes @param {readonly {department_id:string,position_rank?:number|null}[]} memberships @param {readonly {id:string,slug?:string,enabled?:boolean}[]} departments */
export function staffDepartmentMailGroups(groupCodes,memberships,departments){
 const assigned=new Set(groupCodes.map(code=>ranks[code]).filter(rank=>rank>=1&&rank<=5));
 const fallback=assigned.size?Math.min(...assigned):0;
 /** @type {Map<string,number>} */
 const result=new Map();
 for(const member of memberships){
  const dept=departments.find(d=>String(d.id)===String(member.department_id)&&d.enabled!==false);
  const family=dept&&families[String(dept.slug)];
  if(!family)continue;
  const rank=member.position_rank==null?fallback:Number(member.position_rank);
  if(!assigned.has(rank))continue;
  result.set(family,Math.max(result.get(family)||0,rank));
 }
 return [...result.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([family,rank])=>"mail-dept-"+family+"-rank-"+rank);
}
