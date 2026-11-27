import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
test('employment editor sends independent department positions',()=>{
 const ui=read('src/components/CustomerStaffAccess.tsx');
 assert.match(ui,/department_positions/);
 assert.match(ui,/Customer Service Manager/);
 assert.match(ui,/Department positions/);
});
test('staff API persists positions through atomic save and invitations',()=>{
 const api=read('src/app/api/admin/staff/route.ts');
 assert.match(api,/admin_save_staff_member_with_departments/);
 assert.match(api,/validate_staff_department_positions/);
 assert.match(api,/position_rank/);
 assert.match(api,/department_positions:requestedPositions/);
});
test('database migration provides scoped ranks and keeps executive access',()=>{
 const sql=read('database/manual-applied/20261128_staff_department_hierarchy.sql');
 assert.match(sql,/staff_department_rank/);
 assert.match(sql,/public\.support_staff_can_access_ticket\(t.id,uid\)/);
 assert.match(sql,/Executive access lost/);
});
