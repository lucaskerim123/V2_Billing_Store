import test from "node:test";
import assert from "node:assert/strict";
import {composeBaseReleaseFiles} from "../src/lib/base-update-patches.mjs";

const files=rows=>rows.map(([file,data])=>({file,data}));
const asObject=rows=>Object.fromEntries(rows.map(row=>[row.file,row.data]));

test("successive Base updates preserve previously patched files",()=>{
  const base=files([["src/a.ts","a0"],["src/b.ts","b0"],["src/removed.ts","old"]]);
  const first={files:files([["src/a.ts","a1"]]),deletePaths:["src/removed.ts"]};
  const second={files:files([["src/b.ts","b2"]]),deletePaths:[]};
  const result=asObject(composeBaseReleaseFiles(base,[first],second));
  assert.deepEqual(result,{"src/a.ts":"a1","src/b.ts":"b2"});
});

test("newer patch overrides an earlier patch of the same file",()=>{
  const base=files([["src/a.ts","a0"]]);
  const first={files:files([["src/a.ts","a1"]]),deletePaths:[]};
  const second={files:files([["src/a.ts","a2"]]),deletePaths:[]};
  assert.deepEqual(asObject(composeBaseReleaseFiles(base,[first],second)),{"src/a.ts":"a2"});
});

test("removing a rolled-back patch from history restores original Base files",()=>{
  const base=files([["src/a.ts","a0"]]);
  const first={files:files([["src/a.ts","a1"]]),deletePaths:[]};
  assert.deepEqual(asObject(composeBaseReleaseFiles(base,[],first)),{"src/a.ts":"a1"});
  assert.deepEqual(asObject(composeBaseReleaseFiles(base,[],{files:[],deletePaths:[]})),{"src/a.ts":"a0"});
});

test("later successful patches can restore a deleted file",()=>{
  const base=files([["src/a.ts","a0"]]);
  const first={files:[],deletePaths:["src/a.ts"]};
  const second={files:files([["src/a.ts","a2"]]),deletePaths:[]};
  assert.deepEqual(asObject(composeBaseReleaseFiles(base,[first],second)),{"src/a.ts":"a2"});
});
