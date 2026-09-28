export type OrbitReleaseVersion = {
  prefix: 'v' | 'b' | 'd' | null;
  parts: number[];
  prerelease: string | null;
  rank: number;
};

const VERSION_PATTERN=/^([vVbBdD])?\.?(\d+(?:\.\d+){0,7})(?:-([0-9A-Za-z.-]+))?(?:\+([0-9A-Za-z.-]+))?$/;

export function parseOrbitReleaseVersion(value:unknown):OrbitReleaseVersion|null{
  const match=String(value??'').trim().match(VERSION_PATTERN);
  if(!match)return null;
  const prefix=(match[1]?.toLowerCase()||null) as OrbitReleaseVersion['prefix'];
  const parts=match[2].split('.').map(Number);
  if(!parts.length||parts.some((part)=>!Number.isSafeInteger(part)||part<0))return null;
  return {prefix,parts,prerelease:match[3]||null,rank:prefix==='d'?0:prefix==='b'?1:2};
}

export function compareOrbitReleaseVersions(a:unknown,b:unknown):number|null{
  const x=parseOrbitReleaseVersion(a),y=parseOrbitReleaseVersion(b);
  if(!x||!y)return null;
  const width=Math.max(x.parts.length,y.parts.length);
  for(let i=0;i<width;i++){
    const delta=(x.parts[i]||0)-(y.parts[i]||0);
    if(delta)return delta;
  }
  if(x.rank!==y.rank)return x.rank-y.rank;
  if(x.prerelease===y.prerelease)return 0;
  if(x.prerelease===null)return 1;
  if(y.prerelease===null)return -1;
  return x.prerelease.localeCompare(y.prerelease,undefined,{numeric:true,sensitivity:'base'});
}
